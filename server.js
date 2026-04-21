require('dotenv').config();

const app = require('./src/app');
const weeklyScheduleJob = require('./src/jobs/weeklyScheduleJob');

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`✅ Ashesi Shuttle Backend running on Port ${PORT}`);
  weeklyScheduleJob.start();
});
