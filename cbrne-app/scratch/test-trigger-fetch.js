async function trigger() {
  const res = await fetch('https://cbrne-news.vercel.app/api/cron/fetch-news', {
    headers: {
      'Authorization': 'Bearer my-secure-cron-secret-key'
    }
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}
trigger();
