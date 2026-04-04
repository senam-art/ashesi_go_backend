
const supabase = require('../config/supabase');
const journeyService = require('../services/journeyService');


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
        // 1. Check: Does the vehicle exist?
        const { data: vehicle, error: vError } = await supabase
            .from('vehicles')
            .select('vehicle_id, license_plate')
            .eq('vehicle_id', vehicleId)
            .single();

        if (vError || !vehicle) {
            return res.status(404).json({ status: "Vehicle not found. Contact transport office." })
        }

        //2. Check if the vehicle OR driver is already on an active journey
        const { data: activeTrips, error: aError } = await supabase
            .from('active_journeys')
            .select('vehicle_id', 'driver_id')
            .eq('status', 'ONGOING')
            .or(`driver_id.eq.${driverId},vehicle_id.eq.${vehicleId}`);


        // Handle aError
        if (aError) {
            return res.status(500).json({ error: "Database error while checking availability.", details: aError.message });
        }

        // 3. IDENTIFY THE SPECIFIC CONFLICT
        if (activeTrips && activeTrips.length > 0) {
            const isDriverBusy = activeTrips.some(trip => trip.driver_id === driverId);
            const isBusBusy = activeTrips.some(trip => trip.vehicle_id === vehicleId);

            if (isDriverBusy && isBusBusy) {
                return res.status(400).json({ error: "You are already on a trip, and this bus is also in use!" });
            } else if (isDriverBusy) {
                return res.status(400).json({ error: "You already have an ongoing trip. Complete it first." });
            } else if (isBusBusy) {
                return res.status(400).json({ error: "This bus is currently being driven by someone else." });
            }
        }

        //3. Proceed with 'data migration' to active_journeys table
        const { data, error: insertError } = await supabase
            .from('active_journeys')
            .insert([{
                route_id: routeId,
                driver_id: driverId,
                vehicle_id: vehicleId,
                status: 'ONGOING',  // Moves from UPCOMING to LIVE
                current_lap: 1
            }])
            .select()
            .single();


        if (insertError) throw insertError;

        // Return the new Journey ID to Flutter
        res.status(201).json({
            status: "Journey Started ✅",
            journeyId: data.id,
            vehicle: vehicle.license_plate
        });

    } catch (err) {
        res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
};
    
const getActiveJourneys = async (req, res) => {
    try {
        const { data: active_journeys, error } = await supabase
            .from('active_journeys')
            .select('*');
        
        if (error) throw error;

        //Send data back as JSON
        res.status(200).json(active_journeys);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const getRouteData = async (req, res) => {
    // 1. Get the active journey ID from the request 
    const { actJouId } = req.body
    try {
        //Check if journey is active AND get the route_id in one go
        const { data: activeJourneyData, error: ajError } = await supabase
            .from('active_journeys')
            .select('act_jou_id,route_id,routes(route_name)')
            .eq('act_jou_id', actJouId)
            .single();
        
        if (ajError || !activeJourneyData) {
            return res.status(400).json({ error: "Active Journey not found" });
        }


        // 2. Get bus stops
        //use route id to query
        const { data: busStops, error: bError } = await supabase
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

module.exports = { getJourneyData };




module.exports = {
    getRoutes,
    startJourney,
    getActiveJourneys,
    getRouteData,
    getJourneyData

};