const axios = require('axios');
const supabase = require('../config/supabase');

const getRouteWithCache = async (actJouId) => {
    // Fetch Journey and join the Master Route data
    const { data: activeJourney, error: ajError } = await supabase
        .from('active_journeys')
        .select(`
            act_jou_id, 
            route_id, 
            routes (
                route_id, 
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
    const { data: stops, error: sError } = await supabase
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

            // 4. THE FIX: Targeting 'route_id' specifically
            const { error: updateError } = await supabase
                .from('routes')
                .update({ 
                    encoded_polyline: finalPolyline, 
                    polyline_fetched_at: new Date().toISOString(),
                    // Optional: Store distance/duration too since you have the columns!
                    route_distance_meters: routeInfo.distanceMeters,
                    route_duration_seconds: parseInt(routeInfo.duration.replace('s', ''))
                })
                .eq('route_id', targetRouteId); // Matching your routes_pkey

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

module.exports = { getRouteWithCache };