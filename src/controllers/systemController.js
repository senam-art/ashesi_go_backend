const { supabaseAdmin } = require('../config/supabase');
const { sendStopNotification } = require('../utils/firebase');
const weeklyScheduleJob = require('../jobs/weeklyScheduleJob');

const requireAdminSecret = (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
    return false;
  }
  return true;
};

// --- POST /api/scheduler/generate-weekly  (admin) -------------------------
// Used to seed a new recurring_schedules row.
const createRecurringSchedule = async (req, res) => {
  if (!requireAdminSecret(req, res)) return;

  try {
    const { route_id, driver_id, vehicle_id, day_of_week, departure_time } = req.body;
    if (day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week must be between 0 (Sunday) and 6 (Saturday)' });
    }

    const { data, error } = await supabaseAdmin
      .from('recurring_schedules')
      .insert({
        route_id,
        driver_id,
        vehicle_id,
        day_of_week,
        departure_time,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return res
      .status(201)
      .json({ message: 'Recurring schedule created successfully', schedule: data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// --- POST /api/scheduler/run-weekly  (admin) ------------------------------
// Manual trigger of the weekly materializer (useful for testing + backfills).
const runWeeklyNow = async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const result = await weeklyScheduleJob.generateWeekly();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Weekly generator manual run failed:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --- POST /api/scheduler/webhooks/bus-arrival ----------------------------
// Called by a Supabase Database Webhook on stop_visit_summaries INSERT.
const busArrivalNotification = async (req, res) => {
  const { record } = req.body;
  if (!record) return res.status(400).send('No record found');

  try {
    const { route_id, route_name, stop_name } = record;
    await sendStopNotification(route_id, route_name, stop_name);

    console.log(`[bus-arrival] notified passengers for ${stop_name}`);
    return res.status(200).json({ status: 'Notification Sent' });
  } catch (error) {
    console.error('[bus-arrival] FCM failed:', error);
    return res.status(200).send('FCM Failed but Webhook received.');
  }
};

module.exports = {
  createRecurringSchedule,
  runWeeklyNow,
  busArrivalNotification,
};
