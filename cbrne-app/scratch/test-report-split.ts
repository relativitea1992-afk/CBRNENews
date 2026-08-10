import { generateHourlyReport } from '../lib/report-generator';

async function main() {
  console.log('Testing hourly report generation...');
  const res = await generateHourlyReport();
  console.log('Done:', res);
}

main().catch(console.error);
