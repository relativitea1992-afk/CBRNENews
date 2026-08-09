import { generateHourlyReport } from './app/api/cron/hourly-report/route';

async function test() {
  const result = await generateHourlyReport();
  console.log("SUCCESS");
}
test().catch(console.error);
