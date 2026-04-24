const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../config/supabase');

// --- GET /passenger/balance?userId=... -----------------------------------
const getBalance = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return res.status(200).json({ success: true, balance: data.balance });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /passenger/board ------------------------------------------------
// body: { vehicleId, passengerId, dropOffStopId, payForUsername? }
// If payForUsername is set, the caller is paying for someone else.
const processBoarding = async (req, res) => {
  const { vehicleId, passengerId, dropOffStopId, payForUsername } = req.body;

  if (!vehicleId || !passengerId) {
    return res
      .status(400)
      .json({ success: false, message: 'vehicleId and passengerId required.' });
  }

  try {
    // 1. Find the ONGOING journey for this vehicle.
    const { data: journey, error: jError } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        act_jou_id,
        route_id,
        routes ( route_name, fare )
      `)
      .eq('vehicle_id', vehicleId)
      .eq('status', 'ONGOING')
      .maybeSingle();

    if (jError || !journey) {
      console.error('Boarding journey lookup error:', jError);
      return res
        .status(404)
        .json({ success: false, message: 'This bus is not currently on an active journey.' });
    }

    const fare = journey.routes.fare;
    const routeDisplayName = journey.routes.route_name;

    // 2. If a drop-off stop was provided, validate it's on this route and still
    //    ahead of the bus.
    if (dropOffStopId) {
      const { data: rs, error: rsErr } = await supabaseAdmin
        .from('route_structure')
        .select('stop_order')
        .eq('route_id', journey.route_id)
        .eq('bus_stop_id', dropOffStopId)
        .maybeSingle();

      if (rsErr || !rs) {
        return res
          .status(400)
          .json({ success: false, message: 'That stop is not part of this route.' });
      }
    }

    // 3. Resolve friend-pay target if requested.
    let riderId = passengerId;
    if (payForUsername) {
      const u = String(payForUsername).trim().toLowerCase();
      const { data: friend, error: fErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('username', u)
        .maybeSingle();
      if (fErr) throw fErr;
      if (!friend) {
        return res
          .status(404)
          .json({ success: false, message: `No passenger with username @${u}.` });
      }
      if (friend.id === passengerId) {
        return res
          .status(400)
          .json({ success: false, message: "You can't friend-pay yourself." });
      }
      riderId = friend.id;
    }

    // 4. Execute the correct RPC.
    let newBalance;
    if (riderId === passengerId) {
      const { data, error: rpcError } = await supabaseAdmin.rpc('handle_boarding_transaction', {
        p_passenger_id: passengerId,
        p_journey_id: journey.act_jou_id,
        p_fare: fare,
        p_drop_off_stop_id: dropOffStopId || null,
      });
      if (rpcError) {
        if ((rpcError.message || '').includes('Overdraft')) {
          return res.status(402).json({
            success: false,
            message: 'Overdraft limit reached (GHS 50). Please top up to ride again.',
          });
        }
        throw rpcError;
      }
      newBalance = data;
    } else {
      const { data, error: rpcError } = await supabaseAdmin.rpc(
        'handle_friend_boarding_transaction',
        {
          p_payer_id: passengerId,
          p_rider_id: riderId,
          p_journey_id: journey.act_jou_id,
          p_fare: fare,
          p_drop_off_stop_id: dropOffStopId || null,
        }
      );
      if (rpcError) {
        if ((rpcError.message || '').includes('Overdraft')) {
          return res.status(402).json({
            success: false,
            message: 'Overdraft limit reached (GHS 50). Please top up to ride again.',
          });
        }
        throw rpcError;
      }
      newBalance = data;
    }

    const warning =
      newBalance < 0
        ? `Warning: Your balance is GHS ${Number(newBalance).toFixed(2)}. Please top up your wallet soon.`
        : null;

    return res.status(200).json({
      success: true,
      message: `Boarded: ${routeDisplayName}`,
      warning,
      details: {
        fare_deducted: fare,
        remaining_balance: newBalance,
        journey_id: journey.act_jou_id,
        paid_for: riderId === passengerId ? null : riderId,
      },
    });
  } catch (error) {
    console.error('Boarding error:', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'An internal error occurred during boarding.',
    });
  }
};

// Internal helper — given a resolved active_journey, build the drop-off
// picker payload.
async function _stopsAheadPayload(journey) {
  const { data: structure, error: sErr } = await supabaseAdmin
    .from('route_structure')
    .select(`
      stop_order,
      scheduled_arrival,
      bus_stops (bus_stop_id, bus_stop_name, latitude, longitude)
    `)
    .eq('route_id', journey.route_id)
    .order('stop_order', { ascending: true });
  if (sErr) throw sErr;

  const currentIndex = journey.current_stop_index ?? 0;
  const remaining = structure
    .filter((s) => s.stop_order > currentIndex)
    .map((s) => ({
      bus_stop_id: s.bus_stops.bus_stop_id,
      bus_stop_name: s.bus_stops.bus_stop_name,
      latitude: s.bus_stops.latitude,
      longitude: s.bus_stops.longitude,
      stop_order: s.stop_order,
      scheduled_arrival: s.scheduled_arrival,
    }));

  return {
    success: true,
    act_jou_id: journey.act_jou_id,
    route_name: journey.routes?.route_name || null,
    fare: journey.routes?.fare ?? null,
    stops: remaining,
  };
}

// --- GET /passenger/stops-for-vehicle/:vehicleId --------------------------
// Resolve ONGOING journey for vehicle, return route name/fare + stops ahead.
const getStopsForVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  if (!vehicleId) return res.status(400).json({ error: 'vehicleId required' });

  try {
    const { data: journey, error: jErr } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        act_jou_id,
        route_id,
        current_stop_index,
        routes (route_name, fare)
      `)
      .eq('vehicle_id', vehicleId)
      .eq('status', 'ONGOING')
      .maybeSingle();

    if (jErr) throw jErr;
    if (!journey) {
      return res.status(404).json({
        success: false,
        message: 'This bus is not on an active trip right now.',
      });
    }

    const payload = await _stopsAheadPayload(journey);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('stops-for-vehicle error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET /passenger/journey-stops/:actJouId ------------------------------
// Returns the stops ahead of the bus's current position (for drop-off picker).
const getJourneyStops = async (req, res) => {
  const { actJouId } = req.params;
  if (!actJouId) return res.status(400).json({ error: 'actJouId required' });

  try {
    const { data: journey, error: jErr } = await supabaseAdmin
      .from('active_journeys')
      .select('act_jou_id, route_id, current_stop_index, routes(route_name, fare)')
      .eq('act_jou_id', actJouId)
      .single();
    if (jErr || !journey) return res.status(404).json({ error: 'Journey not found' });

    const payload = await _stopsAheadPayload(journey);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Journey stops error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /passenger/resolve-tag  body: { uid, uidHash? } -----------------
// Maps an NFC tag UID to a vehicle_id when the tag is not NDEF-formatted.
const resolveTag = async (req, res) => {
  const { uid, uidHash } = req.body;
  if (!uid && !uidHash) {
    return res.status(400).json({ success: false, message: 'uid or uidHash required' });
  }

  try {
    const hash = uidHash || crypto.createHash('sha256').update(String(uid)).digest('hex');

    const { data, error } = await supabaseAdmin
      .from('vehicle_tags')
      .select('vehicle_id, label, is_active')
      .eq('uid_hash', hash)
      .maybeSingle();

    if (error) throw error;
    if (!data || !data.is_active) {
      return res.status(404).json({ success: false, message: 'Tag not recognized.' });
    }

    return res.status(200).json({
      success: true,
      vehicleId: data.vehicle_id,
      label: data.label,
    });
  } catch (error) {
    console.error('Tag resolve error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET /passenger/daily-upcoming-trips ---------------------------------
const getDailyUpcomingTrips = async (req, res) => {
  try {
    const { driverId, date } = req.query;
    
    // 1. Logic: Use provided date or default to Today
    const targetDate = date ? new Date(date) : new Date();
    
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // 2. Query the Materialized JOURNEYS table
    let query = supabaseAdmin
      .from('journeys')
      .select(`
        journey_id,
        scheduled_at,
        status,
        vehicle_id,
        routes ( 
          id, 
          route_name, 
          description, 
          fare,
          route_structure (
            stop_order,
            bus_stops (bus_stop_name)
          )
        )
      `)
      .gte('scheduled_at', startOfDay.toISOString())
      .lte('scheduled_at', endOfDay.toISOString())
      // We exclude 'COMPLETED' trips from the active schedule view
      .in('status', ['SCHEDULED', 'ONGOING','COMPLETED'])
      .order('scheduled_at', { ascending: true });

    // 3. Filter by Driver if provided
    if (driverId) {
      query = query.eq('driver_id', driverId);
    }

    const { data: trips, error: fetchError } = await query;

    if (fetchError) {
      console.error('Daily journeys query error:', fetchError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error occurred while fetching journeys.' 
      });
    }

    return res.status(200).json({
      success: true,
      message: `Found ${trips.length} journeys for ${targetDate.toDateString()}.`,
      data: trips, // Flutter app expects this list
    });
  } catch (error) {
    console.error('Daily journeys error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'An internal server error occurred.',
    });
  }
};
// --- GET /passenger/history/:userId --------------------------------------
// Completed trips for this passenger, most recent first. Combines boardings
// with the owning active_journey + route so the client doesn't need to stitch.
const getPassengerHistory = async (req, res) => {
  const { userId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('boardings')
      .select(`
        id,
        boarded_at,
        active_journey_id,
        active_journeys (
          status,
          completed_at,
          started_at,
          routes ( route_name, fare )
        )
      `)
      .eq('passenger_id', userId)
      .order('boarded_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const trips = (data || []).map((row) => {
      const journey = row.active_journeys || {};
      const route = journey.routes || {};
      return {
        id: row.id,
        boarded_at: row.boarded_at,
        completed_at: journey.completed_at,
        started_at: journey.started_at,
        status: journey.status || 'UNKNOWN',
        route_name: route.route_name || 'Ashesi Shuttle',
        fare: route.fare != null ? Number(route.fare) : null,
      };
    });

    return res.status(200).json({ success: true, trips });
  } catch (err) {
    console.error('Passenger history error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBalance,
  processBoarding,
  getJourneyStops,
  getStopsForVehicle,
  resolveTag,
  getDailyUpcomingTrips,
  getPassengerHistory,
};
