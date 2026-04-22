const { supabaseAdmin } = require('../config/supabase');
const { httpJson } = require('../utils/http');
const { logLine } = require('../utils/verboseLog');

// ---------------------------------------------------------------------------
// getRouteWithCache
//   Pulls journey + route + stops; if the route's polyline is stale (>24h)
//   or missing, calls Google Routes v2 computeRoutes to refresh it.
// ---------------------------------------------------------------------------
const getRouteWithCache = async (actJouId) => {
  // 1. Fetch active journey + master route.
  const { data: activeJourney, error: ajError } = await supabaseAdmin
    .from('active_journeys')
    .select(`
      act_jou_id,
      route_id,
      routes (
        id,
        route_name,
        encoded_polyline,
        polyline_fetched_at
      )
    `)
    .eq('act_jou_id', actJouId)
    .single();

  if (ajError || !activeJourney) throw new Error('Active Journey not found');

  logLine('routeCache', `getRouteWithCache start actJouId=${actJouId}`);

  const routeMaster = activeJourney.routes;
  const targetRouteId = activeJourney.route_id;

  // 2. Fetch ordered bus stops for this route.
  const { data: stops, error: sError } = await supabaseAdmin
    .from('route_structure')
    .select(`
      stop_order,
      scheduled_arrival,
      bus_stops(bus_stop_id, bus_stop_name, latitude, longitude)
    `)
    .eq('route_id', targetRouteId)
    .order('stop_order', { ascending: true });

  if (sError || !stops || stops.length < 2) throw new Error('Route stops missing');

  // 3. Cache check.
  const lastFetched = routeMaster.polyline_fetched_at
    ? new Date(routeMaster.polyline_fetched_at)
    : new Date(0);
  const hoursSinceUpdate = (Date.now() - lastFetched.getTime()) / (1000 * 60 * 60);
  const needsUpdate = !routeMaster.encoded_polyline || hoursSinceUpdate > 24;

  logLine(
    'routeCache',
    `polyline cache actJouId=${actJouId} routeId=${targetRouteId} ` +
      `needsRefresh=${needsUpdate} hoursSincePolylineFetch=${hoursSinceUpdate.toFixed(2)} ` +
      `hasPolyline=${Boolean(routeMaster.encoded_polyline)} stops=${stops.length}`
  );

  let finalPolyline = routeMaster.encoded_polyline;
  let distanceMeters = null;
  let durationSeconds = null;

  if (needsUpdate) {
    logLine('routeCache', `calling Google Routes API for routeId=${targetRouteId}`);
    try {
      const first = stops[0].bus_stops;
      const last = stops[stops.length - 1].bus_stops;
      const middle = stops.slice(1, -1).map((s) => s.bus_stops);

      const payload = {
        origin: { location: { latLng: { latitude: first.latitude, longitude: first.longitude } } },
        destination: { location: { latLng: { latitude: last.latitude, longitude: last.longitude } } },
        intermediates: middle.map((m) => ({
          location: { latLng: { latitude: m.latitude, longitude: m.longitude } },
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        polylineEncoding: 'ENCODED_POLYLINE',
      };

      const googleResp = await httpJson(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_KEY,
            'X-Goog-FieldMask':
              'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
          },
          body: payload,
          timeoutMs: 8000,
        }
      );

      const routeInfo = googleResp?.routes?.[0];
      if (routeInfo) {
        finalPolyline = routeInfo.polyline?.encodedPolyline || finalPolyline;
        distanceMeters = routeInfo.distanceMeters ?? null;
        if (routeInfo.duration && typeof routeInfo.duration === 'string') {
          durationSeconds = parseInt(routeInfo.duration.replace('s', ''), 10) || null;
        }

        const { error: updateError } = await supabaseAdmin
          .from('routes')
          .update({
            encoded_polyline: finalPolyline,
            polyline_fetched_at: new Date().toISOString(),
            route_distance_meters: distanceMeters,
            route_duration_seconds: durationSeconds,
          })
          .eq('id', targetRouteId);

        if (updateError) {
          console.error('Route cache update failed:', updateError.message);
        } else {
          logLine('routeCache', `Supabase routes row updated routeId=${targetRouteId}`);
        }
      }
    } catch (err) {
      console.error('Google Routes API error:', err.body?.message || err.message);
    }
  } else {
    logLine('routeCache', `using cached polyline routeId=${targetRouteId} (no Google call)`);
  }

  logLine(
    'routeCache',
    `getRouteWithCache done actJouId=${actJouId} polylineChars=${finalPolyline ? String(finalPolyline).length : 0}`
  );

  return {
    act_jou_id: activeJourney.act_jou_id,
    route_name: routeMaster.route_name,
    encoded_polyline: finalPolyline,
    stops,
  };
};

// ---------------------------------------------------------------------------
// getUpcomingTrips — /scheduler/fetch-all-trips
//   Accepts ?day=<dart weekday 1..7> (Mon..Sun). Returns active recurring
//   schedules for that postgres day (Sun=0..Sat=6).
// ---------------------------------------------------------------------------
const getUpcomingTrips = async (req, res) => {
  logLine('scheduler', `fetch-all-trips incoming query=${JSON.stringify(req.query)}`);
  try {
    let targetDayPostgres;

    if (req.query.day) {
      const dartDay = parseInt(req.query.day, 10);
      if (Number.isNaN(dartDay) || dartDay < 1 || dartDay > 7) {
        return res.status(400).json({ success: false, message: 'Invalid day parameter. Must be 1-7.' });
      }
      // Dart: Mon=1..Sun=7 → Postgres: Sun=0..Sat=6
      targetDayPostgres = dartDay === 7 ? 0 : dartDay;
    } else {
      targetDayPostgres = new Date().getUTCDay();
    }

    const { data: trips, error: fetchError } = await supabaseAdmin
      .from('recurring_schedules')
      .select(`
        schedule_id,
        departure_time,
        vehicle_id,
        routes (
          id,
          route_name,
          description,
          fare
        )
      `)
      .eq('day_of_week', targetDayPostgres)
      .eq('is_active', true)
      .order('departure_time', { ascending: true });

    if (fetchError) {
      console.error('Upcoming trips fetch error:', fetchError);
      return res.status(500).json({ success: false, message: 'Database error fetching schedules.' });
    }

    logLine('scheduler', `fetch-all-trips ok rows=${(trips || []).length} dayPg=${targetDayPostgres}`);
    return res.status(200).json({ success: true, data: trips });
  } catch (error) {
    console.error('Upcoming trips unexpected error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

module.exports = { getRouteWithCache, getUpcomingTrips };
