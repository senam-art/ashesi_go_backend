const { supabase, supabaseAdmin } = require('../config/supabase');
const journeyService = require('../services/journeyService');
const { sendGlobalDriverAlert } = require('../utils/firebase');

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

// --- PATCH /api/driver/start-trip ---------------------------------------
const startJourney = async (req, res) => {
  const { journeyId, driverId, vehicleId } = req.body;

  if (!journeyId || !driverId || !vehicleId) {
    return res.status(400).json({ error: 'journeyId, driverId, and vehicleId are required.' });
  }

  try {
    // 1. Verify the specific Scheduled Journey exists
    const { data: scheduledTrip, error: sError } = await supabaseAdmin
      .from('journeys')
      .select('status, route_id')
      .eq('journey_id', journeyId)
      .single();

    if (sError || !scheduledTrip) {
      return res.status(404).json({ error: 'Trip not found in the schedule.' });
    }

    // 2. Prevent re-starting an already active trip
    if (scheduledTrip.status === 'ONGOING') {
      return res.status(400).json({ error: 'This trip is already live.' });
    }

    // 3. Conflict Check: Ensure Driver/Bus aren't already busy elsewhere
    const { data: conflicts, error: cError } = await supabaseAdmin
      .from('journeys')
      .select('journey_id, vehicle_id, driver_id')
      .eq('status', 'ONGOING')
      .or(`driver_id.eq.${driverId},vehicle_id.eq.${vehicleId}`);

    if (conflicts && conflicts.length > 0) {
      const driverBusy = conflicts.find(t => t.driver_id === driverId);
      if (driverBusy) {
        return res.status(409).json({ 
          error: 'You are already in another active journey.', 
          journeyId: driverBusy.journey_id 
        });
      }
      
      const busBusy = conflicts.find(t => t.vehicle_id === vehicleId);
      if (busBusy) {
        return res.status(409).json({ error: 'This bus is currently in use by another driver.' });
      }
    }

    // 4. ACTIVATE: Update the master record status
    // ✨ SYNCED: Using 'actual_started_at' to match our SQL schema
    const { error: uError } = await supabaseAdmin
      .from('journeys')
      .update({
        status: 'ONGOING',
        vehicle_id: vehicleId,
        actual_started_at: new Date().toISOString() 
      })
      .eq('journey_id', journeyId);

    if (uError) throw uError;

    // 5. INITIALIZE LIVE STATE: This makes the bus appear on the map
    const { error: stateError } = await supabaseAdmin
      .from('active_journey_states')
      .insert([{
        journey_id: journeyId,
        current_stop_index: 0,
        is_at_stop: true, 
        last_updated: new Date().toISOString()
      }]);

    if (stateError) {
      // Rollback: Return to SCHEDULED if the live state fails to initialize
      await supabaseAdmin.from('journeys').update({ status: 'SCHEDULED' }).eq('journey_id', journeyId);
      throw stateError;
    }

    return res.status(200).json({
      success: true,
      message: 'Journey activated successfully',
      journeyId: journeyId
    });

  } catch (err) {
    console.error('Start Journey Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};

const DRIVER_ALERT_TEMPLATES = {
  BUS_BREAKDOWN: {
    title: 'Shuttle service disruption',
    body: 'Bus issue reported. Please expect delays while a replacement is arranged.',
  },
  EMERGENCY_STOP: {
    title: 'Emergency stop update',
    body: 'The shuttle made an emergency stop. Operations will resume once it is safe.',
  },
  HEAVY_TRAFFIC: {
    title: 'Heavy traffic delay',
    body: 'Route is experiencing unusual traffic. Arrival times may shift.',
  },
  WEATHER_DELAY: {
    title: 'Weather-related delay',
    body: 'Travel speed is reduced due to weather conditions. Please plan extra time.',
  },
  ROUTE_DIVERSION: {
    title: 'Route diversion notice',
    body: 'The shuttle is temporarily using an alternate route due to road conditions.',
  },
};

// --- POST /driver/broadcast-alert -----------------------------------------
// Driver operational broadcast to all app users via FCM topic `all_users`.
const broadcastAlert = async (req, res) => {
  const { driverId, code, customMessage } = req.body || {};

  if (!driverId || !code) {
    return res.status(400).json({ error: 'driverId and code are required' });
  }

  const template = DRIVER_ALERT_TEMPLATES[code];
  if (!template) {
    return res.status(400).json({
      error: 'Unsupported alert code',
      allowed: Object.keys(DRIVER_ALERT_TEMPLATES),
    });
  }

  try {
    // Minimal authorization guard: user must be a driver profile.
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, first_name, last_name')
      .eq('id', driverId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile || profile.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can send broadcasts' });
    }

    const cleanCustom = typeof customMessage === 'string' ? customMessage.trim() : '';
    const body = cleanCustom.length > 0 ? cleanCustom : template.body;
    const senderName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();

    const result = await sendGlobalDriverAlert({
      title: template.title,
      body,
      data: {
        code,
        driver_id: driverId,
        sender_name: senderName,
      },
      topic: 'all_users',
    });

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        error: result.error || 'FCM send failed',
      });
    }

    return res.status(200).json({
      success: true,
      code,
      title: template.title,
      body,
      fcm: result,
    });
  } catch (err) {
    console.error('broadcastAlert error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- GET /driver/active-journeys -----------------------------------------

const getActiveJourneys = async (req, res) => {
  try {
    const { data: journeys, error } = await supabaseAdmin
      .from('journeys')
      .select(`
        journey_id,
        status,
        routes (
          route_name,
          encoded_polyline,
          sitting_capacity, -- Ensure this is in your routes or vehicles table
          route_structure (
            scheduled_arrival,
            bus_stops (
              bus_stop_name,
              latitude,
              longitude
            )
          )
        ),
        active_journey_states (*)
      `)
      .eq('status', 'ONGOING');

    if (error) throw error;

    const formatted = journeys.map((j) => {
      const state = j.active_journey_states?.[0] || {}; // Handle array response
      const route = j.routes || {};
      
      return {
        act_jou_id: j.journey_id,
        route_name: route.route_name,
        status: j.status,
        encoded_polyline: route.encoded_polyline,
        current_passenger_count: state.current_passenger_count || 0,
        current_stop_index: state.current_stop_index || 0,
        last_known_lat: state.last_known_lat,
        last_known_lng: state.last_known_lng,
        // ✨ Map the nested stops so the RouteData.fromJson can find them
        bus_stops: route.route_structure?.map(s => ({
          name: s.bus_stops.bus_stop_name,
          latitude: s.bus_stops.latitude,
          longitude: s.bus_stops.longitude,
          scheduled_arrival: s.scheduled_arrival
        })) || []
      };
    });

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
      .from('journeys')
      .select('journey_id,route_id,routes(route_name)')
      .eq('journey_id', actJouId)
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
      .from('journeys') 
      .select(`
        journey_id,
        route_id,
        vehicle_id,
        status,
        scheduled_at,
        actual_started_at,
        routes ( route_name ),
        active_journey_states ( 
          current_stop_index,
          is_at_stop 
        ) 
      `)
      .eq('driver_id', driverId)
      .eq('status', 'ONGOING')
      // Order by the actual start time to get the most recent active trip
      .order('actual_started_at', { ascending: false }) 
      .limit(1);

    if (error) {
      console.error('Database error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const row = rows && rows[0];
    if (!row) {
      return res.status(200).json({ ongoing: false });
    }

    /**
     * Supabase returns joined one-to-one relations as an object or 
     * a single-element array depending on schema definitions.
     * We safely handle both here.
     */
    const liveState = Array.isArray(row.active_journey_states) 
      ? row.active_journey_states[0] 
      : row.active_journey_states;

    return res.status(200).json({
      ongoing: true,
      journeyId: row.journey_id, 
      route_id: row.route_id,
      vehicle_id: row.vehicle_id,
      route_name: row.routes?.route_name || 'Unknown Route',
      scheduled_at: row.scheduled_at,
      actual_started_at: row.actual_started_at,
      current_stop_index: liveState?.current_stop_index || 0,
      is_at_stop: liveState?.is_at_stop ?? false
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
  console.log(`[DEBUG] Attempting recordArrival for Journey: ${actJouId}`);

  // 1. Fetch Journey (Naked query - no joins to avoid RLS/Join errors)
  const { data: journey, error: jError } = await supabaseAdmin
    .from('journeys')
    .select('journey_id, route_id')
    .eq('journey_id', actJouId)
    .single();

  // If this fails, we log the EXACT error from Supabase
  if (jError || !journey) {
    console.error('[DEBUG] Supabase Fetch Error:', jError);
    throw new Error(`Active journey not found. (ID: ${actJouId})`);
  }

  const routeId = journey.route_id;

  // 2. Fetch Route Metadata separately
  const { data: routeData } = await supabaseAdmin
    .from('routes')
    .select('route_name')
    .eq('id', routeId)
    .single();
    
  const routeName = routeData?.route_name || 'Unknown Route';

  // 3. Validate Stop in Route Structure
  const { data: struct, error: sError } = await supabaseAdmin
    .from('route_structure')
    .select(`
      stop_order, 
      scheduled_arrival, 
      bus_stops (bus_stop_name)
    `)
    .eq('route_id', routeId)
    .eq('bus_stop_id', stopId)
    .single();

  if (sError || !struct) {
    console.error(`[DEBUG] Stop Check Failed. Route: ${routeId}, Stop: ${stopId}`);
    throw new Error("This stop is not part of this route's structure.");
  }

  const { stop_order: stopOrder, scheduled_arrival: scheduledArrival } = struct;
  const stopName = struct.bus_stops?.bus_stop_name || 'Unknown Stop';

  // 4. Time/Delay Logic
  const nowIso = new Date().toISOString();
  let isDelayed = false;
  if (scheduledArrival) {
    const [hours, minutes] = scheduledArrival.split(':');
    const scheduled = new Date();
    scheduled.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
    isDelayed = (Date.now() - scheduled.getTime()) > 10 * 60 * 1000;
  }

  // 5. Log the Visit
  const { error: visitError } = await supabaseAdmin
    .from('stop_visit_summaries')
    .insert([{
      active_journey_id: actJouId,
      stop_id: stopId,
      arrival_time: nowIso,
      is_delayed: isDelayed,
      route_id: routeId,
      route_name: routeName,
      stop_name: stopName,
    }]);

  if (visitError) throw visitError;

  // 6. Update LIVE STATE (active_journey_states)
  await supabaseAdmin
    .from('active_journey_states')
    .update({ 
      current_stop_index: stopOrder,
      updated_at: nowIso 
    })
    .eq('journey_id', actJouId);

  return { stopName };
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
      return res.status(400).json({ error: 'Cannot DEPART a stop that was never ARRIVED at.' });
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
  // We'll accept 'journeyId' or 'actJouId' for backward compatibility
  const journeyId = req.body.journeyId || req.body.actJouId;

  if (!journeyId) {
    return res.status(400).json({ error: 'journeyId (or actJouId) required' });
  }

  try {
    // 1. Get the current passenger count from the state table before deleting it
  const { data: state } = await supabaseAdmin
    .from('active_journey_states')
    .select('current_passenger_count')
    .eq('journey_id', journeyId)
    .single();

  const finalCount = state?.current_passenger_count || 0;
    
    // 1. Update the Master Record (journeys)
    // We mark it COMPLETED and set the final timestamp.
    await supabaseAdmin
    .from('journeys')
    .update({ 
      status: 'COMPLETED', 
      completed_at: new Date().toISOString(),
      final_passenger_count: finalCount // ✨ Save the count here!
    })
    .eq('journey_id', journeyId);

    // 2. Delete the Ephemeral State (active_journey_states)
    // This removes the "live" presence from the system (GPS, current stop, etc.)
    // but leaves the 'journeys' record and all linked 'boardings' intact.
   await supabaseAdmin
    .from('active_journey_states')
    .delete()
    .eq('journey_id', journeyId);

    return res.status(200).json({ 
      success: true, 
      message: 'Trip completed and state archived.',
      journey 
    });

  } catch (error) {
    console.error('End trip error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- GET /driver/journey/status/:actJouId ---------------------------------
const getJourneyStatus = async (req, res) => {
  // Support both param names for transition period
  const journeyId = req.params.journeyId || req.params.actJouId;

  try {
    // 1. Fetch Journey Master AND Live State
    const { data: journey, error: jError } = await supabaseAdmin
      .from('journeys')
      .select(`
        journey_id,
        route_id,
        vehicle_id,
        status,
        routes (route_name, encoded_polyline, fare),
        active_journey_states (
          current_stop_index,
          current_passenger_count,
          last_known_lat,
          last_known_lng
        )
      `)
      .eq('journey_id', journeyId)
      .single();

    if (jError || !journey) {
      console.error('Supabase journey error:', jError);
      return res.status(404).json({ error: 'Journey record not found' });
    }

    // 2. Fetch the static Route Structure (The sequence of stops)
    const { data: structure, error: sError } = await supabaseAdmin
      .from('route_structure')
      .select(`
        stop_order,
        scheduled_arrival,
        bus_stops (bus_stop_id, bus_stop_name, latitude, longitude)
      `)
      .eq('route_id', journey.route_id)
      .order('stop_order', { ascending: true });

    if (sError) throw sError;

    // 3. Fetch the actual Visit Logs for this specific trip
    const { data: visits, error: vError } = await supabaseAdmin
      .from('stop_visit_summaries')
      .select('stop_id, arrival_time, departed_at, is_delayed')
      .eq('active_journey_id', journeyId);

    if (vError) throw vError;

    // 4. Merge structure with actual visit data
    const stops = structure.map((s) => {
      const visit = visits.find((v) => v.stop_id === s.bus_stops.bus_stop_id);
      return {
        id: s.bus_stops.bus_stop_id,
        name: s.bus_stops.bus_stop_name,
        latitude: s.bus_stops.latitude,
        longitude: s.bus_stops.longitude,
        stop_order: s.stop_order,
        scheduled_arrival: s.scheduled_arrival,
        actual_arrival: visit ? visit.arrival_time : null,
        departed_at: visit ? visit.departed_at : null,
        is_delayed: visit ? visit.is_delayed : false,
      };
    });

    // 5. Determine current state
    // If the trip is COMPLETED, active_journey_states will be null. 
    // We fall back to sensible defaults.
    const liveState = journey.active_journey_states || {};
    const currentIndex = liveState.current_stop_index ?? 0;
    
    const currentStop = stops[currentIndex];
    const isAtStop = !!(currentStop && currentStop.actual_arrival && !currentStop.departed_at);

    // 6. Return formatted JSON matching your Flutter RouteData model
    return res.status(200).json({
      act_jou_id: journey.journey_id,
      journey_id: journey.journey_id,
      route_id: journey.route_id,
      vehicle_id: journey.vehicle_id,
      route_name: journey.routes?.route_name || 'Unknown Route',
      status: journey.status,
      passenger_count: liveState.current_passenger_count || 0,
      current_stop_index: currentIndex,
      last_known_lat: liveState.last_known_lat,
      last_known_lng: liveState.last_known_lng,
      is_at_stop: isAtStop,
      encoded_polyline: journey.routes?.encoded_polyline,
      bus_stops: stops, // Matches the 'bus_stops' key in your Dart model
    });

  } catch (error) {
    console.error('Status lookup error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// --- GET /driver/history/:driverId ---------------------------------------
const getDriverHistory = async (req, res) => {
  const { driverId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  if (!driverId) {
    return res.status(400).json({ success: false, message: 'driverId required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('journeys') 
      .select(`
        journey_id,
        status,
        started_at,
        completed_at,
        final_passenger_count, 
        vehicle_id,
        routes ( 
          route_name, 
          route_distance_meters, 
          route_duration_seconds,
          fare 
        ),
        vehicles ( license_plate, model )
      `)
      .eq('driver_id', driverId)
      // We typically only want to show finished trips in History
      .in('status', ['COMPLETED', 'CANCELLED']) 
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const trips = (data || []).map((j) => ({
      id: j.journey_id, // Consistent with new naming
      status: j.status,
      started_at: j.started_at,
      completed_at: j.completed_at,
      passengers: j.final_passenger_count || 0,
      route_name: j.routes?.route_name || 'Ashesi Shuttle',
      route_distance_meters: j.routes?.route_distance_meters || 0,
      route_duration_seconds: j.routes?.route_duration_seconds || 0,
      license_plate: j.vehicles?.license_plate || 'N/A',
      vehicle_model: j.vehicles?.model || 'Toyota Coaster',
      fare_collected: (j.final_passenger_count || 0) * (j.routes?.fare || 0)
    }));

    // Summary stats
    const completed = trips.filter((t) => t.status === 'COMPLETED');
    
    const totalDistanceKm = completed.reduce(
      (sum, t) => sum + (t.route_distance_meters || 0),
      0
    ) / 1000;

    const totalPassengers = completed.reduce(
      (sum, t) => sum + (t.passengers || 0), 
      0
    );

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
  broadcastAlert,
};
