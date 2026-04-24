const { supabaseAdmin } = require('../config/supabase');

const generateWeekly = async () => {
  console.log('[Job] Starting weekly journey materialization...');
  
  try {
    // 1. Fetch active templates
    const { data: templates, error: tError } = await supabaseAdmin
      .from('recurring_schedules')
      .select('*')
      .eq('is_active', true);

    if (tError) throw tError;

    const newJourneys = [];
    const today = new Date();

    // 2. Generate trips for the next 7 days
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date();
      targetDate.setDate(today.getDate() + i);
      const dayOfWeek = targetDate.getDay(); // 0 (Sun) - 6 (Sat)

      const dailyTemplates = templates.filter(t => t.day_of_week === dayOfWeek);

      dailyTemplates.forEach(t => {
        const [hours, minutes] = t.departure_time.split(':');
        const scheduledTime = new Date(targetDate);
        scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        newJourneys.push({
          schedule_id: t.schedule_id, // Link to template
          route_id: t.route_id,
          driver_id: t.driver_id,
          vehicle_id: t.vehicle_id,
          status: 'SCHEDULED', // ✨ Consistent status
          scheduled_at: scheduledTime.toISOString(), // ✨ Consistent name
          current_lap: 1
        });
      });
    }

    // 3. Insert journeys (Use upsert if you want to avoid duplicates on manual re-runs)
    const { error: iError } = await supabaseAdmin
      .from('journeys')
      .upsert(newJourneys, { onConflict: 'schedule_id, scheduled_at' }); 

    if (iError) throw iError;

    return { count: newJourneys.length };
  } catch (error) {
    throw error;
  }
};

module.exports = { generateWeekly };