import { GET } from './app/api/cron/fetch-news/route.ts';

async function run() {
  process.env.CRON_SECRET = 'test';
  const req = new Request('http://localhost:3000/api/cron/fetch-news?secret=test');
  const res = await GET(req);
  console.log("Response status:", res.status);
  const data = await res.json();
  console.log("Response data:", data);
}

run().catch(console.error);
