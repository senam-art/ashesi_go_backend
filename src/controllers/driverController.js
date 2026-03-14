const supabase = require('../config/supabase');

const getDashboard = async (req, res) => {
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
            .select('id, license_plate')
            .eq('id', vehicleId)
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

module.exports = { getDashboard, startJourney };