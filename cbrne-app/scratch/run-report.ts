import { generateHourlyReport } from '../lib/report-generator';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log("Running hourly report...");
  const start = Date.now();
  await generateHourlyReport();
  console.log(`Finished in ${Date.now() - start}ms`);
}

run().catch(console.error);
