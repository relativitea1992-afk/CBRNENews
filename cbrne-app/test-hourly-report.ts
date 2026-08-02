import { GET } from './app/api/cron/hourly-report/route';

async function testHourlyReport() {
  console.log('Testing hourly report cron...');
  // Mock request object
  const request = new Request('http://localhost:3000/api/cron/hourly-report', {
    headers: new Headers({ 'authorization': `Bearer ${process.env.CRON_SECRET || ''}` })
  });
  
  const response = await GET(request);
  const data = await response.json();
  console.log('Response:', response.status, data);
}

testHourlyReport().catch(console.error);
