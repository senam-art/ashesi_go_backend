// POST /api/admin/schedules
const { supabaseAdmin } = require('../config/supabase');
const { sendStopNotification } = require('../utils/firebase');

const createRecurringSchedule = async (req, res) => {
    try {
        // 1. Simple Secret Check
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
            return res.status(401).json({ error: "Unauthorized: Invalid Admin Secret" });
        }

        // --- SUCCESS! PROCEED WITH CREATION ---
        const { route_id, driver_id, vehicle_id, day_of_week, departure_time } = req.body;

        // Basic validation
        if (day_of_week < 0 || day_of_week > 6) {
            return res.status(400).json({ error: "day_of_week must be between 0 (Sunday) and 6 (Saturday)" });
        }

        const { data, error } = await supabaseAdmin
            .from('recurring_schedules')
            .insert({
                route_id,
                driver_id,
                vehicle_id,
                day_of_week,
                departure_time,
                is_active: true // Defaults to true based on your schema
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            message: "Recurring schedule created successfully",
            schedule: data
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const busArrivalNotification = async (req, res) => {
        // Supabase sends the new row in 'req.body.record'
    const { record } = req.body; 

    if (!record) return res.status(400).send("No record found");

    try {
        const { route_id, route_name, stop_name } = record;

        // 🚀 FCM LOGIC LIVES HERE NOW
        await sendStopNotification(`route_${route_id}`, route_name, stop_name);
        await sendStopNotification('all_shuttles', route_name, stop_name);

        console.log(`✅ Webhook: Notification sent for ${stop_name}`);
        return res.status(200).json({ status: "Notification Sent" });

    } catch (error) {
        console.error("❌ Webhook FCM Error:", error);
        // We still return 200/OK so Supabase doesn't keep retrying 
        // a broken notification.
        return res.status(200).send("FCM Failed but Webhook received.");
    }

};


module.exports = {
    createRecurringSchedule,
    busArrivalNotification
}