// Combine the Supabase imports into one destructured line
const { supabase, supabaseAdmin } = require('../config/supabase');

const journeyService = require('../services/journeyService');
const crypto = require('crypto');


const getRoutes = async (req, res) => {
    try {
        const { data: routes, error } = await supabase
            .from('routes')
            .select('*, route_structure(scheduled_arrival)');

        if (error) throw error;

        res.json({
            status: "Success",
            dashboard: {
                stats: { totalTrips: 124, totalPassengers: 1205 },
                immediateTrip: routes[0],
                otherTrips: routes.slice(1)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const startJourney = async (req, res) => {
    const { routeId, driverId, vehicleId } = req.body;

    try {
        // 1. VALIDATION: Does the vehicle exist?
        const { data: vehicle, error: vError } = await supabaseAdmin
            .from('vehicles')
            .select('vehicle_id, license_plate')
            .eq('vehicle_id', vehicleId)
            .single();

        if (vError || !vehicle) {
            return res.status(404).json({ error: "Vehicle not found. Contact transport office." });
        }

        // 2. CONFLICT CHECK: Is the vehicle OR driver already on an active journey?
        const { data: activeTrips, error: aError } = await supabaseAdmin
            .from('active_journeys')
            .select('vehicle_id, driver_id')
            .eq('status', 'ONGOING')
            .or(`driver_id.eq.${driverId},vehicle_id.eq.${vehicleId}`);

        if (aError) {
            return res.status(500).json({ error: "Database error.", details: aError.message });
        }

        if (activeTrips && activeTrips.length > 0) {
            const isDriverBusy = activeTrips.some(trip => trip.driver_id === driverId);
            const isBusBusy = activeTrips.some(trip => trip.vehicle_id === vehicleId);

            if (isDriverBusy && isBusBusy) return res.status(400).json({ error: "You and this bus are already on a trip!" });
            if (isDriverBusy) return res.status(400).json({ error: "You already have an ongoing trip. Complete it first." });
            if (isBusBusy) return res.status(400).json({ error: "This bus is currently being driven by someone else." });
        }


        // 4. MIGRATION: Insert into active_journeys
        const { data, error: insertError } = await supabaseAdmin
            .from('active_journeys')
            .insert([{
                route_id: routeId,
                driver_id: driverId,
                vehicle_id: vehicleId,
                status: 'ONGOING',
                current_lap: 1,
                started_at: new Date()
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        // 5. RESPONSE: Return active journey id to Driver App for QR /nfc taps
        res.status(201).json({
            status: "Journey Started ✅",
            journeyId: data.act_jou_id,
            vehicle: vehicle.license_plate
        });

    } catch (err) {
        console.error("Start Journey Error:", err.message);
        res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
};

const getActiveJourneys = async (req, res) => {
    try {
        // Fetch journeys AND join the 'routes' table to get the polyline and name
        const { data: active_journeys, error } = await supabaseAdmin
            .from('active_journeys')
            .select(`
                *,
                routes (
                    route_name,
                    encoded_polyline
                )
            `);

        if (error) throw error;

        // Map over the results to flatten the JSON for Flutter
        const formattedData = active_journeys.map(journey => ({
            act_jou_id: journey.act_jou_id,
            route_id: journey.route_id,
            status: journey.status,
            current_passenger_count: journey.current_passenger_count || 0,
            // Safely extract from the joined 'routes' table
            route_name: journey.routes?.route_name || "Unknown Route",
            encoded_polyline: journey.routes?.encoded_polyline || "",
            // Keep the nullable fields, we'll handle them in Flutter
            last_known_lat: journey.last_known_lat,
            last_known_lng: journey.last_known_lng
        }));

        res.status(200).json(formattedData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}


const getRouteData = async (req, res) => {
    // 1. Get the active journey ID from the request 
    const { actJouId } = req.body
    try {
        //Check if journey is active AND get the route_id in one go
        const { data: activeJourneyData, error: ajError } = await supabaseAdmin
            .from('active_journeys')
            .select('act_jou_id,route_id,routes(route_name)')
            .eq('act_jou_id', actJouId)
            .single();

        if (ajError || !activeJourneyData) {
            return res.status(400).json({ error: "Active Journey not found" });
        }


        // 2. Get bus stops
        //use route id to query
        const { data: busStops, error: bError } = await supabaseAdmin
            .from('route_structure')
            .select(`stop_order, scheduled_arrival, bus_stops(bus_stop_id,bus_stop_name,latitude,longitude)`)
            .eq('route_id', activeJourneyData.route_id)
            .order('stop_order', { ascending: true });



        if (bError) {
            return res.status(500).json({ error: bError.message });
        }



        return res.json({
            status: "Success", route_name: activeJourneyData.routes.route_name, act_jou_id: actJouId, stops: busStops
        })
    }



    catch (error) {
        return res.status(500).json({ error: error.message })
    }


};



const getJourneyData = async (req, res) => {
    const { actJouId } = req.body;

    try {
        if (!actJouId) {
            return res.status(400).json({ status: "Error", message: "actJouId required" });
        }

        // The Service does all the DB and Google work
        const data = await journeyService.getRouteWithCache(actJouId);

        return res.json({
            status: "Success",
            ...data
        });
    } catch (error) {
        console.error("Controller Error:", error.message);
        return res.status(500).json({ status: "Error", message: error.message });
    }
};


const getTodaySchedule = async (req, res) => {
    try {

        const { driverId } = req.query;


        if (!driverId) {
            return res.status(400).json({ error: 'Driver ID is required' });
        }
        // 1. Determine today's day of the week
        // JavaScript getUTCDay() returns 0 (Sunday) to 6 (Saturday).
        // This perfectly matches your Postgres check constraint: (day_of_week >= 0) and (day_of_week <= 6)
        const today = new Date();
        const currentDayOfWeek = today.getDay(); // Local day
        const currentUTCDay = today.getUTCDay();

        console.log(`LOCAL DAY: ${currentDayOfWeek}, UTC DAY: ${currentUTCDay}`);

        // 2. Query Supabase
        // We join the 'routes' table to get the route_name and expected_passengers
        // Ensure currentDayOfWeek is an integer and is_active is a boolean
        // 2. The Query
        const { data: schedules, error } = await supabaseAdmin
            .from('recurring_schedules')
            .select(`
        schedule_id,
        route_id,
        vehicle_id,
        departure_time,
        is_active,
        routes (
            route_name
        )
    `)
            .eq('driver_id', driverId)
            .eq('day_of_week', currentDayOfWeek) // This will be 3 today
            .eq('is_active', true);

        if (error) {
            // This logs the REAL reason to your terminal
            console.error("Supabase Error:", error.message);
            return res.status(500).json({
                error: error.message,
                details: error.details,
                hint: error.hint
            });
        }

        // 3. Flatten the response for Flutter
        // Supabase returns joined tables as nested objects (e.g., schedule.routes.route_name).
        // We flatten it so Flutter can easily read trip['route_name'].
        const formattedSchedules = schedules.map(schedule => ({
            schedule_id: schedule.schedule_id,
            route_id: schedule.route_id,
            vehicle_id: schedule.vehicle_id,
            departure_time: schedule.departure_time, // e.g., "14:30:00"
            route_name: schedule.routes?.route_name || "Unknown Route",
        }));

        // 4. Send back the clean array
        return res.status(200).json({ schedules: formattedSchedules });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};


const recordStopVisit = async (req, res) => {
    // ✨ Only two inputs needed from the Flutter app now!
    const { actJouId, stopId } = req.body;

    try {
        // 1. Get the Route ID from the Active Journey
        const { data: journey, error: jError } = await supabaseAdmin
            .from('active_journeys')
            .select(`route_id, routes (route_name)`)
            .eq('act_jou_id', actJouId)
            .single();

        if (jError || !journey) throw new Error("Active journey not found.");

        const routeId = journey.route_id;
        const routeName = journey.routes.route_name;

        // 2. Look up the Stop Order and Scheduled Arrival from Route Structure
        const { data: struct, error: sError } = await supabaseAdmin
            .from('route_structure')
            .select(`stop_order, scheduled_arrival, bus_stops (bus_stop_name)`)
            .eq('route_id', routeId)
            .eq('bus_stop_id', stopId)
            .single();

        if (sError || !struct) throw new Error("This stop is not part of this route's structure.");

        const stopOrder = struct.stop_order;
        const scheduledArrival = struct.scheduled_arrival; // Format: "HH:mm:ss"
        const stopName = struct.bus_stops.bus_stop_name;

        // 3. Calculate Delay
        const now = new Date();
        let isDelayed = false;

        if (scheduledArrival) {
            const scheduled = new Date();
            const [hours, minutes] = scheduledArrival.split(':');
            scheduled.setHours(parseInt(hours), parseInt(minutes), 0);

            // Logic: Mark as delayed if current time > scheduled + 10 mins
            isDelayed = (now - scheduled) > 10 * 60 * 1000;
        }

       // 4. Record the visit in stop_visit_summaries
        // ✨ NOTICE: We include the IDs and Names here for the Webhook to use
        const { data: visit, error: visitError } = await supabaseAdmin
            .from('stop_visit_summaries')
            .insert([{
                active_journey_id: actJouId,
                stop_id: stopId,
                arrival_time: now.toISOString(),
                is_delayed: isDelayed,
                route_id: routeId,      // ✨ Added
                route_name: routeName,  // ✨ Added
                stop_name: stopName     // ✨ Added
            }])
            .select()
            .single();

        if (visitError) throw visitError;

        // 5. Update Live Position in active_journeys
        await supabaseAdmin
            .from('active_journeys')
            .update({ current_stop_order: stopOrder })
            .eq('act_jou_id', actJouId);

        // 🚀 THE FCM LOGIC IS REMOVED FROM HERE! 

        return res.status(200).json({
            success: true,
            message: `Arrived at ${stopName}. Database updated.`,
        });

    } catch (error) {
        console.error("Stop Visit Error:", error);
        return res.status(500).json({ error: error.message });
    }
};


/**
 * Fetches the current state of a journey, merging the route plan with visit history.
 */
const getJourneyStatus = async (req, res) => {
    const { actJouId } = req.params;

    try {
        // 1. Get Journey Info (Pulling capacity and passenger count from active_journeys)
        const { data: journey, error: jError } = await supabaseAdmin
            .from('active_journeys')
            .select(`
                act_jou_id,
                route_id,
                status,
                current_capacity,
                current_passenger_count,
                routes (route_name, encoded_polyline)
            `)
            .eq('act_jou_id', actJouId)
            .single();

        if (jError || !journey) {
            console.error("Supabase Journey Error:", jError);
            return res.status(404).json({ error: "Journey record not found" });
        }

        // 2. Get the full Route Structure (The "Plan")
        const { data: structure, error: sError } = await supabaseAdmin
            .from('route_structure')
            .select(`
                stop_order,
                scheduled_arrival,
                bus_stops (bus_stop_id, bus_stop_name)
            `)
            .eq('route_id', journey.route_id)
            .order('stop_order', { ascending: true });

        if (sError) {
            console.error("Supabase Structure Error:", sError);
            throw sError;
        }

        // 3. Get existing visits (The "History")
        const { data: visits, error: vError } = await supabaseAdmin
            .from('stop_visit_summaries')
            .select('stop_id, arrival_time, is_delayed')
            .eq('active_journey_id', actJouId);

        if (vError) {
            console.error("Supabase Visits Error:", vError);
            throw vError;
        }

        // 4. Map the stops: Combine the Plan with the History
        const stops = structure.map(s => {
            const visit = visits.find(v => v.stop_id === s.bus_stops.bus_stop_id);
            return {
                id: s.bus_stops.bus_stop_id,
                name: s.bus_stops.bus_stop_name,
                stop_order: s.stop_order,
                scheduled_arrival: s.scheduled_arrival,
                actual_arrival: visit ? visit.arrival_time : null,
                is_delayed: visit ? visit.is_delayed : false
            };
        });

        // 5. Calculate the current position
        // Finds the index of the first stop that hasn't been visited yet
        const nextStop = stops.findIndex(s => s.actual_arrival === null);

        // 6. Final Unified Response
        return res.status(200).json({
            act_jou_id: journey.act_jou_id,
            route_name: journey.routes.route_name,
            status: journey.status,
            passenger_count: journey.current_passenger_count,
            capacity: journey.current_capacity,
            encoded_polyline: journey.routes.encoded_polyline,
            // If all stops are visited, indexWhere returns -1; we default to the last stop
            current_stop_index: nextStop === -1 ? stops.length - 1 : nextStop,
            stops: stops
        });

    } catch (error) {
        console.error("Status Lookup Error:", error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getRoutes,
    startJourney,
    getActiveJourneys,
    getRouteData,
    getJourneyData,
    getTodaySchedule,
    recordStopVisit,
    getJourneyStatus

};