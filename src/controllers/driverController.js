const { supabase, supabaseAdmin } = require('../config/supabase');
const journeyService = require('../services/journeyService');

// --- GET /driver/routes ---------------------------------------------------
const getRoutes = async (req, res) => {
  try {
    const { data: routes, error } = await supabase
      .from('routes')
      .select('*, route_structure(scheduled_arrival)');

    if (error) throw error;

    res.json({
      status: 'Success',
      dashboard: {
        immediateTrip: routes[0],
        otherTrips: routes.slice(1),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- POST /driver/start-trip ---------------------------------------------
const startJourney = async (req, res) => {
  const { routeId, driverId, vehicleId } = req.body;

  try {
    const { data: vehicle, error: vError } = await supabaseAdmin
      .from('vehicles')
      .select('vehicle_id, license_plate')
      .eq('vehicle_id', vehicleId)
      .single();

    if (vError || !vehicle) {
      return res.status(404).json({ error: 'Vehicle not found. Contact transport office.' });
    }

    const { data: activeTrips, error: aError } = await supabaseAdmin
      .from('active_journeys')
      .select('act_jou_id, vehicle_id, driver_id')
      .eq('status', 'ONGOING')
      .or(`driver_id.eq.${driverId},vehicle_id.eq.${vehicleId}`);

    if (aError) {
      return res.status(500).json({ error: 'Database error.', details: aError.message });
    }

    if (activeTrips && activeTrips.length > 0) {
      const sameDriverAndBus = activeTrips.find(
        (t) => t.driver_id === driverId && t.vehicle_id === vehicleId
      );
      if (sameDriverAndBus) {
        return res.status(409).json({
          error: 'You and this bus are already on a trip!',
          journeyId: sameDriverAndBus.act_jou_id,
        });
      }

      const driverRow = activeTrips.find((t) => t.driver_id === driverId);
      if (driverRow) {
        return res.status(409).json({
          error: 'You already have an ongoing trip. Complete it first.',
          journeyId: driverRow.act_jou_id,
        });
      }

      const isBusBusy = activeTrips.some((t) => t.vehicle_id === vehicleId);
      if (isBusBusy) {
        return res.status(400).json({ error: 'This bus is currently being driven by someone else.' });
      }
    }

    const { data, error: insertError } = await supabaseAdmin
      .from('active_journeys')
      .insert([
        {
          route_id: routeId,
          driver_id: driverId,
          vehicle_id: vehicleId,
          status: 'ONGOING',
          current_lap: 1,
          current_stop_index: 0,
          started_at: new Date(),
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      status: 'Journey Started',
      journeyId: data.act_jou_id,
      vehicle: vehicle.license_plate,
    });
  } catch (err) {
    console.error('Start Journey Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};

// --- GET /driver/active-journeys -----------------------------------------
const getActiveJourneys = async (req, res) => {
  try {
    const { data: journeys, error } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        *,
        routes (
          route_name,
          encoded_polyline
        )
      `);

    if (error) throw error;

    const formatted = journeys.map((j) => ({
      act_jou_id: j.act_jou_id,
      route_id: j.route_id,
      status: j.status,
      current_passenger_count: j.current_passenger_count || 0,
      current_stop_index: j.current_stop_index || 0,
      route_name: j.routes?.route_name || 'Unknown Route',
      encoded_polyline: j.routes?.encoded_polyline || '',
      last_known_lat: j.last_known_lat,
      last_known_lng: j.last_known_lng,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /driver/route-data ---------------------------------------------
const getRouteData = async (req, res) => {
  const { actJouId } = req.body;
  try {
    const { data: activeJourneyData, error: ajError } = await supabaseAdmin
      .from('active_journeys')
      .select('act_jou_id,route_id,routes(route_name)')
      .eq('act_jou_id', actJouId)
      .single();

    if (ajError || !activeJourneyData) {
      return res.status(400).json({ error: 'Active Journey not found' });
    }

    const { data: busStops, error: bError } = await supabaseAdmin
      .from('route_structure')
      .select(`stop_order, scheduled_arrival, bus_stops(bus_stop_id,bus_stop_name,latitude,longitude)`)
      .eq('route_id', activeJourneyData.route_id)
      .order('stop_order', { ascending: true });

    if (bError) return res.status(500).json({ error: bError.message });

    return res.json({
      status: 'Success',
      route_name: activeJourneyData.routes.route_name,
      act_jou_id: actJouId,
      stops: busStops,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /driver/journey-data -------------------------------------------
const getJourneyData = async (req, res) => {
  const { actJouId } = req.body;
  try {
    if (!actJouId) {
      return res.status(400).json({ status: 'Error', message: 'actJouId required' });
    }
    const data = await journeyService.getRouteWithCache(actJouId);
    return res.json({ status: 'Success', ...data });
  } catch (error) {
    console.error('journey-data controller error:', error.message);
    return res.status(500).json({ status: 'Error', message: error.message });
  }
};

// --- GET /driver/my-ongoing-journey?driverId=... ---------------------------
// Lets the app recover after restart: one ONGOING row for this driver.
const getMyOngoingJourney = async (req, res) => {
  try {
    const { driverId } = req.query;
    if (!driverId) {
      return res.status(400).json({ error: 'driverId is required' });
    }

    const { data: rows, error } = await supabaseAdmin
      .from('active_journeys')
      .select(
        `
        act_jou_id,
        route_id,
        vehicle_id,
        status,
        started_at,
        routes ( route_name )
      `
      )
      .eq('driver_id', driverId)
      .eq('status', 'ONGOING')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const row = rows && rows[0];
    if (!row) {
      return res.status(200).json({ ongoing: false });
    }

    return res.status(200).json({
      ongoing: true,
      journeyId: row.act_jou_id,
      route_id: row.route_id,
      vehicle_id: row.vehicle_id,
      route_name: row.routes?.route_name || 'Unknown Route',
      started_at: row.started_at,
    });
  } catch (err) {
    console.error('getMyOngoingJourney error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// --- GET /driver/schedule/today?driverId=... ------------------------------
const getTodaySchedule = async (req, res) => {
  try {
    const { driverId } = req.query;
    if (!driverId) return res.status(400).json({ error: 'Driver ID is required' });

    const currentDayOfWeek = new Date().getDay();

    const { data: schedules, error } = await supabaseAdmin
      .from('recurring_schedules')
      .select(`
        schedule_id,
        route_id,
        vehicle_id,
        departure_time,
        is_active,
        routes ( route_name )
      `)
      .eq('driver_id', driverId)
      .eq('day_of_week', currentDayOfWeek)
      .eq('is_active', true);

    if (error) {
      console.error('Supabase schedule error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const formatted = schedules.map((s) => ({
      schedule_id: s.schedule_id,
      route_id: s.route_id,
      vehicle_id: s.vehicle_id,
      departure_time: s.departure_time,
      route_name: s.routes?.route_name || 'Unknown Route',
    }));

    return res.status(200).json({ schedules: formatted });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// recordArrival: shared body for legacy recordStopVisit + record-action ARRIVE
// ---------------------------------------------------------------------------
const recordArrival = async ({ actJouId, stopId }) => {
  const { data: journey, error: jError } = await supabaseAdmin
    .from('active_journeys')
    .select(`route_id, routes (route_name)`)
    .eq('act_jou_id', actJouId)
    .single();
  if (jError || !journey) throw new Error('Active journey not found.');

  const routeId = journey.route_id;
  const routeName = journey.routes.route_name;

  const { data: struct, error: sError } = await supabaseAdmin
    .from('route_structure')
    .select(`stop_order, scheduled_arrival, bus_stops (bus_stop_name)`)
    .eq('route_id', routeId)
    .eq('bus_stop_id', stopId)
    .single();
  if (sError || !struct) throw new Error("This stop is not part of this route's structure.");

  const stopOrder = struct.stop_order;
  const scheduledArrival = struct.scheduled_arrival;
  const stopName = struct.bus_stops.bus_stop_name;

  let isDelayed = false;
  if (scheduledArrival) {
    const scheduled = new Date();
    const [hours, minutes] = scheduledArrival.split(':');
    scheduled.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
    isDelayed = Date.now() - scheduled.getTime() > 10 * 60 * 1000;
  }

  const now = new Date().toISOString();
  const { data: visit, error: visitError } = await supabaseAdmin
    .from('stop_visit_summaries')
    .insert([
      {
        active_journey_id: actJouId,
        stop_id: stopId,
        arrival_time: now,
        is_delayed: isDelayed,
        route_id: routeId,
        route_name: routeName,
        stop_name: stopName,
      },
    ])
    .select()
    .single();
  if (visitError) throw visitError;

  await supabaseAdmin
    .from('active_journeys')
    .update({ current_stop_index: stopOrder })
    .eq('act_jou_id', actJouId);

  return { visit, stopName };
};

// --- POST /driver/journey/record-stop  (legacy, kept for back-compat) -----
const recordStopVisit = async (req, res) => {
  const { actJouId, stopId } = req.body;
  try {
    const { stopName } = await recordArrival({ actJouId, stopId });
    return res.status(200).json({
      success: true,
      message: `Arrived at ${stopName}. Database updated.`,
    });
  } catch (error) {
    console.error('Stop Visit Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /driver/journey/record-action  (ARRIVE | DEPART) ----------------
const recordStopAction = async (req, res) => {
  const { actJouId, stopId, action } = req.body;

  if (!actJouId || !stopId || !action) {
    return res.status(400).json({ error: 'actJouId, stopId, action required' });
  }
  if (action !== 'ARRIVE' && action !== 'DEPART') {
    return res.status(400).json({ error: "action must be 'ARRIVE' or 'DEPART'" });
  }

  try {
    if (action === 'ARRIVE') {
      const { stopName } = await recordArrival({ actJouId, stopId });
      return res.status(200).json({ success: true, action, stopName });
    }

    // DEPART: stamp departed_at on the most recent stop_visit_summaries
    // row for this journey+stop.
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('stop_visit_summaries')
      .select('stop_visit_id')
      .eq('active_journey_id', actJouId)
      .eq('stop_id', stopId)
      .order('arrival_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) {
      return res.status(400).json({ error: 'Cannot DEPART a stop that was never ARRIVEd at.' });
    }

    const { error: updErr } = await supabaseAdmin
      .from('stop_visit_summaries')
      .update({ departed_at: new Date().toISOString() })
      .eq('stop_visit_id', existing.stop_visit_id);

    if (updErr) throw updErr;

    return res.status(200).json({ success: true, action });
  } catch (error) {
    console.error('Record action error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /driver/end-trip ------------------------------------------------
const endTrip = async (req, res) => {
  const { actJouId } = req.body;
  if (!actJouId) return res.status(400).json({ error: 'actJouId required' });

  try {
    const { data, error } = await supabaseAdmin
      .from('active_journeys')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('act_jou_id', actJouId)
      .select('act_jou_id, status, completed_at')
      .single();

    if (error) throw error;
    return res.status(200).json({ success: true, journey: data });
  } catch (error) {
    console.error('End trip error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- GET /driver/journey/status/:actJouId ---------------------------------
const getJourneyStatus = async (req, res) => {
  const { actJouId } = req.params;

  try {
    const { data: journey, error: jError } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        act_jou_id,
        route_id,
        vehicle_id,
        status,
        current_capacity,
        current_passenger_count,
        current_stop_index,
        routes (route_name, encoded_polyline)
      `)
      .eq('act_jou_id', actJouId)
      .single();

    if (jError || !journey) {
      console.error('Supabase journey error:', jError);
      return res.status(404).json({ error: 'Journey record not found' });
    }

    const { data: structure, error: sError } = await supabaseAdmin
      .from('route_structure')
      .select(`
        stop_order,
        scheduled_arrival,
        bus_stops (bus_stop_id, bus_stop_name)
      `)
      .eq('route_id', journey.route_id)
      .order('stop_order', { ascending: true });
    if (sError) throw sError;

    const { data: visits, error: vError } = await supabaseAdmin
      .from('stop_visit_summaries')
      .select('stop_id, arrival_time, departed_at, is_delayed')
      .eq('active_journey_id', actJouId);
    if (vError) throw vError;

    const stops = structure.map((s) => {
      const visit = visits.find((v) => v.stop_id === s.bus_stops.bus_stop_id);
      return {
        id: s.bus_stops.bus_stop_id,
        name: s.bus_stops.bus_stop_name,
        stop_order: s.stop_order,
        scheduled_arrival: s.scheduled_arrival,
        actual_arrival: visit ? visit.arrival_time : null,
        departed_at: visit ? visit.departed_at : null,
        is_delayed: visit ? visit.is_delayed : false,
      };
    });

    // Bus is "at stop" if latest visit for current stop has arrived but not departed.
    const currentStop = stops[journey.current_stop_index] || stops[0];
    const isAtStop = !!(currentStop && currentStop.actual_arrival && !currentStop.departed_at);

    const nextUnvisited = stops.findIndex((s) => s.actual_arrival === null);

    return res.status(200).json({
      act_jou_id: journey.act_jou_id,
      vehicle_id: journey.vehicle_id,
      route_name: journey.routes.route_name,
      status: journey.status,
      passenger_count: journey.current_passenger_count,
      capacity: journey.current_capacity,
      encoded_polyline: journey.routes.encoded_polyline,
      current_stop_index:
        journey.current_stop_index ??
        (nextUnvisited === -1 ? stops.length - 1 : nextUnvisited),
      is_at_stop: isAtStop,
      stops,
    });
  } catch (error) {
    console.error('Status lookup error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- GET /driver/history/:driverId ---------------------------------------
// Completed journeys for a driver with passenger counts + route metadata.
const getDriverHistory = async (req, res) => {
  const { driverId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  if (!driverId) {
    return res.status(400).json({ success: false, message: 'driverId required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        act_jou_id,
        status,
        started_at,
        completed_at,
        current_passenger_count,
        current_capacity,
        vehicle_id,
        routes ( route_name, route_distance_meters, route_duration_seconds ),
        vehicles ( license_plate, model )
      `)
      .eq('driver_id', driverId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const trips = (data || []).map((j) => ({
      id: j.act_jou_id,
      status: j.status,
      started_at: j.started_at,
      completed_at: j.completed_at,
      passengers: j.current_passenger_count || 0,
      capacity: j.current_capacity || 0,
      route_name: j.routes?.route_name || 'Ashesi Shuttle',
      route_distance_meters: j.routes?.route_distance_meters || null,
      route_duration_seconds: j.routes?.route_duration_seconds || null,
      license_plate: j.vehicles?.license_plate || null,
      vehicle_model: j.vehicles?.model || null,
    }));

    // Summary stats: totals across completed journeys only.
    const completed = trips.filter((t) => t.status === 'COMPLETED');
    const totalDistanceKm = completed.reduce(
      (sum, t) => sum + (t.route_distance_meters || 0),
      0
    ) / 1000;
    const totalPassengers = completed.reduce((sum, t) => sum + (t.passengers || 0), 0);

    return res.status(200).json({
      success: true,
      trips,
      summary: {
        total_trips: completed.length,
        total_passengers: totalPassengers,
        total_distance_km: Number(totalDistanceKm.toFixed(1)),
      },
    });
  } catch (err) {
    console.error('Driver history error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// --- GET /driver/profile/:driverId ---------------------------------------
// Returns the canonical driver record joined with the most recently assigned
// vehicle (inferred from their latest active journey, including upcoming).
const getDriverProfile = async (req, res) => {
  const { driverId } = req.params;
  if (!driverId) {
    return res.status(400).json({ success: false, message: 'driverId required' });
  }

  try {
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select(
        'id, first_name, last_name, username, phone_number, role, total_rides, profile_image_url'
      )
      .eq('id', driverId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile || profile.role !== 'driver') {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const { data: driverRow } = await supabaseAdmin
      .from('drivers')
      .select('driver_id, is_verified, created_at')
      .eq('driver_id', driverId)
      .maybeSingle();

    const { data: latestJourney } = await supabaseAdmin
      .from('active_journeys')
      .select('vehicle_id, status, started_at, vehicles (license_plate, model, sitting_capacity)')
      .eq('driver_id', driverId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.status(200).json({
      success: true,
      profile: {
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        full_name: `${profile.first_name} ${profile.last_name}`.trim(),
        username: profile.username,
        phone_number: profile.phone_number,
        total_rides: profile.total_rides || 0,
        profile_image_url: profile.profile_image_url,
        is_verified: driverRow?.is_verified || false,
        member_since: driverRow?.created_at || null,
        vehicle: latestJourney?.vehicles
          ? {
              id: latestJourney.vehicle_id,
              license_plate: latestJourney.vehicles.license_plate,
              model: latestJourney.vehicles.model,
              capacity: latestJourney.vehicles.sitting_capacity,
              last_journey_status: latestJourney.status,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('Driver profile error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getRoutes,
  startJourney,
  getActiveJourneys,
  getRouteData,
  getJourneyData,
  getTodaySchedule,
  getMyOngoingJourney,
  recordStopVisit,
  recordStopAction,
  endTrip,
  getJourneyStatus,
  getDriverHistory,
  getDriverProfile,
};
