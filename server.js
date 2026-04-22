require('dotenv').config();

const app = require('./src/app');
const weeklyScheduleJob = require('./src/jobs/weeklyScheduleJob');
const { VERBOSE_HTTP, ts } = require('./src/utils/verboseLog');

process.on('unhandledRejection', (reason) => {
  console.error(`[${ts()}] [unhandledRejection]`, reason);
});
process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] [uncaughtException]`, err && err.stack ? err.stack : err);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`[${ts()}] ✅ Ashesi Shuttle Backend running on port ${PORT}`);
  console.log(
    `[${ts()}] Verbose HTTP request/response logging: ${VERBOSE_HTTP ? 'ON' : 'OFF'} ` +
      '(set VERBOSE_HTTP_LOG=false to disable)'
  );
  weeklyScheduleJob.start();
});
