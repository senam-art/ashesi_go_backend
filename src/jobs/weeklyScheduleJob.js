/**
 * weeklyScheduleJob.js
 *
 * Runs every Sunday at 23:55 Africa/Accra and materializes the next 7 days'
 * trips from `recurring_schedules` into `active_journeys` with status=UPCOMING.
 *
 * Idempotent by virtue of migration 007_upcoming_unique.sql (unique index on
 * route_id+vehicle_id+driver_id+started_at while status='UPCOMING').
 */

const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');

const DAYS_AHEAD = 7;

/**
 * For a given cron-run date, build the list of (scheduleRow, scheduledDate)
 * pairs for the next DAYS_AHEAD days.
 */
function buildUpcomingCandidates(schedules, runAt) {
  const out = [];
  for (let offset = 1; offset <= DAYS_AHEAD; offset++) {
    const d = new Date(runAt);
    d.setUTCDate(d.getUTCDate() + offset);
    const pgDay = d.getUTCDay();

    for (const s of schedules) {
      if (!s.is_active || s.day_of_week !== pgDay) continue;

      const [hh, mm, ss = '0'] = String(s.departure_time).split(':');
      const departure = new Date(d);
      departure.setUTCHours(parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10), 0);

      out.push({
        schedule: s,
        startedAt: departure.toISOString(),
      });
    }
  }
  return out;
}

async function generateWeekly({ runAt = new Date() } = {}) {
  const { data: schedules, error } = await supabaseAdmin
    .from('recurring_schedules')
    .select('schedule_id, route_id, driver_id, vehicle_id, day_of_week, departure_time, is_active')
    .eq('is_active', true);

  if (error) throw error;

  const candidates = buildUpcomingCandidates(schedules, runAt);
  if (candidates.length === 0) {
    return { inserted: 0, skipped: 0, total: 0 };
  }

  const rows = candidates.map((c) => ({
    route_id: c.schedule.route_id,
    driver_id: c.schedule.driver_id,
    vehicle_id: c.schedule.vehicle_id,
    status: 'UPCOMING',
    current_lap: 1,
    current_stop_index: 0,
    started_at: c.startedAt,
  }));

  // Upsert relies on the unique index from migration 007.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('active_journeys')
    .upsert(rows, {
      onConflict: 'route_id,vehicle_id,driver_id,started_at',
      ignoreDuplicates: true,
    })
    .select('act_jou_id');

  if (insErr) throw insErr;

  return {
    total: rows.length,
    inserted: (inserted || []).length,
    skipped: rows.length - (inserted || []).length,
  };
}

function start() {
  if (process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('[weeklyScheduleJob] ENABLE_SCHEDULER not true, not scheduling.');
    return null;
  }

  // Sunday 23:55 in Africa/Accra.
  const task = cron.schedule(
    '55 23 * * 0',
    async () => {
      const startedAt = Date.now();
      try {
        const result = await generateWeekly();
        console.log(
          `[weeklyScheduleJob] done in ${Date.now() - startedAt}ms`,
          result
        );
      } catch (err) {
        console.error('[weeklyScheduleJob] failure:', err.message);
      }
    },
    { timezone: 'Africa/Accra' }
  );

  console.log('[weeklyScheduleJob] scheduled: Sun 23:55 Africa/Accra');
  return task;
}

module.exports = { start, generateWeekly };
