const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase');

const getRouteWithCache = async (actJouId) => {
    // Fetch Journey and join the Master Route data
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
    
    if (ajError || !activeJourney) throw new Error("Active Journey not found");

    const routeMaster = activeJourney.routes;
    const targetRouteId = activeJourney.route_id;

    // 2. Fetch the Bus Stops
    const { data: stops, error: sError } = await supabaseAdmin
        .from('route_structure')
        .select(`
            stop_order, 
            scheduled_arrival, 
            bus_stops(bus_stop_id, bus_stop_name, latitude, longitude)
        `)
        .eq('route_id', targetRouteId)
        .order('stop_order', { ascending: true });
    
    if (sError || !stops || stops.length < 2) throw new Error("Route stops missing");

    // 3. Cache Logic
    const lastFetched = routeMaster.polyline_fetched_at ? new Date(routeMaster.polyline_fetched_at) : new Date(0);
    const hoursSinceUpdate = (new Date() - lastFetched) / (1000 * 60 * 60);
    const needsUpdate = !routeMaster.encoded_polyline || hoursSinceUpdate > 24;

    let finalPolyline = routeMaster.encoded_polyline;

    if (needsUpdate) {
        try {
            const first = stops[0].bus_stops;
            const last = stops[stops.length - 1].bus_stops;
            const middle = stops.slice(1, -1).map(s => s.bus_stops);

            const payload = {
                origin: { location: { latLng: { latitude: first.latitude, longitude: first.longitude } } },
                destination: { location: { latLng: { latitude: last.latitude, longitude: last.longitude } } },
                intermediates: middle.map(m => ({
                    location: { latLng: { latitude: m.latitude, longitude: m.longitude } }
                })),
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE',
                polylineEncoding: 'ENCODED_POLYLINE'
            };

            const response = await axios.post(
                'https://routes.googleapis.com/directions/v2:computeRoutes',
                payload, 
                {
                    headers: {
                        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_KEY,
                        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration'
                    }
                }
            );

            const routeInfo = response.data.routes[0];
            finalPolyline = routeInfo.polyline.encodedPolyline;

            // DB update with data fetched from Google API
            const { error: updateError } = await supabase
                .from('routes')
                .update({ 
                    encoded_polyline: finalPolyline, 
                    polyline_fetched_at: new Date().toISOString(),
                    //  Store distance/duration 
                    route_distance_meters: routeInfo.distanceMeters,
                    route_duration_seconds: parseInt(routeInfo.duration.replace('s', ''))
                })
                .eq('route_id', targetRouteId); a

            if (updateError) {
                console.error("Update failed:", updateError.message);
            }

        } catch (err) {
            console.error("Google API Error:", err.message);
        }
    }

    return {
        act_jou_id: activeJourney.act_jou_id,
        route_name: routeMaster.route_name,
        encoded_polyline: finalPolyline,
        stops: stops
    };
};


const getUpcomingTrips = async (req, res) => {
  try {
    let targetDayPostgres;

    // 1. Check if Flutter sent a specific day in the URL (e.g., ?day=3)
    if (req.query.day) {
      const dartDay = parseInt(req.query.day, 10);
      
      if (isNaN(dartDay) || dartDay < 1 || dartDay > 7) {
        return res.status(400).json({ success: false, message: "Invalid day parameter. Must be 1-7." });
      }

      //  TRANSLATION LOGIC:
      // Dart: Monday=1, ..., Saturday=6, Sunday=7
      // Postgres: Sunday=0, Monday=1, ..., Saturday=6
      targetDayPostgres = dartDay === 7 ? 0 : dartDay; 
      
      console.log(`Fetching trips for requested Dart day ${dartDay} (Postgres day ${targetDayPostgres})`);
    } else {
      // 2. Default fallback: If no day provided, use today's GMT day
      targetDayPostgres = new Date().getUTCDay();
      console.log(`No day provided. Defaulting to today GMT (Postgres day ${targetDayPostgres})`);
    }

    // 3. Fetch from Supabase
    const { data: trips, error: fetchError } = await supabaseAdmin
      .from('recurring_schedules')
      .select(`
        schedule_id,
        departure_time,
        vehicle_id,
        routes (
          id,
          name,
          start_location,
          end_location
        )
      `)
      .eq('day_of_week', targetDayPostgres) 
      .eq('is_active', true)
      .order('departure_time', { ascending: true });

    if (fetchError) {
      console.error("Supabase Query Error:", fetchError);
      return res.status(500).json({ success: false, message: "Database error fetching schedules." });
    }

    res.status(200).json({ success: true, data: trips });

  } catch (error) {
    console.error("Upcoming Trips Error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};


module.exports = { getRouteWithCache, getUpcomingTrips};