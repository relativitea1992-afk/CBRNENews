const { GET: fetchNews } = require('./app/api/cron/fetch-news/route');
const { generateHourlyReport } = require('./app/api/cron/hourly-report/route');
const { POST: telegramWebhook } = require('./app/api/telegram-webhook/route');

async function main() {
  console.log('Running fetchNews...');
  const res1 = await fetchNews(new Request('http://localhost/api/cron/fetch-news'));
  console.log('fetchNews result:', await res1.json());
  
  console.log('\nRunning hourlyReport...');
  const metrics = await generateHourlyReport();
  console.log('hourlyReport metrics:', metrics);
  
  console.log('\nTesting /resource command...');
  const req = new Request('http://localhost/api/telegram-webhook', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        chat: { id: process.env.TELEGRAM_CHAT_ID },
        text: '/resource 7',
        from: { username: 'test_user' }
      }
    })
  });
  const res3 = await telegramWebhook(req);
  console.log('/resource result:', await res3.json());
}

main().catch(console.error);
