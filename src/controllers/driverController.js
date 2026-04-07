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

        // 3. TOKEN GENERATION: Create the dynamic boarding code
        // This generates a unique 6-character hex string (e.g., 'ago_f3d2e1')
        const boardingToken = `ago_${crypto.randomBytes(3).toString('hex')}`;

        // 4. MIGRATION: Insert into active_journeys with the Token
        const { data, error: insertError } = await supabaseAdmin
            .from('active_journeys')
            .insert([{
                route_id: routeId,
                driver_id: driverId,
                vehicle_id: vehicleId,
                boarding_token: boardingToken, // NEW: Secured token saved here
                status: 'ONGOING',
                current_lap: 1,
                start_time: new Date()
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        // 5. RESPONSE: Return Token to Driver App for QR Generation
        res.status(201).json({
            status: "Journey Started ✅",
            journeyId: data.act_jou_id,
            token: boardingToken, // Driver App uses this for the QR code
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
            status: "Success",route_name:activeJourneyData.routes.route_name, act_jou_id: actJouId, stops: busStops
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





module.exports = {
    getRoutes,
    startJourney,
    getActiveJourneys,
    getRouteData,
    getJourneyData

};