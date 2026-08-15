process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.TELEGRAM_CHAT_ID = 'test';
import { generateHourlyReport } from '../lib/report-generator';

async function run() {
  console.log('Starting simulated hourly report generation...');
  const start = Date.now();
  try {
    const metrics = await generateHourlyReport();
    console.log('Finished successfully in', Date.now() - start, 'ms');
  } catch (e) {
    console.error('Failed in', Date.now() - start, 'ms', e);
  }
}

run();
