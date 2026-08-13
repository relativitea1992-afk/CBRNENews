async function checkApi(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`\n=== Response for ${url} ===`);
    console.log(JSON.stringify(data, null, 2).substring(0, 500) + '...');
  } catch (e) {
    console.error(`Error for ${url}:`, e);
  }
}

async function main() {
  await checkApi('https://api.data.gov.sg/v1/environment/wind-speed');
  await checkApi('https://api.data.gov.sg/v1/environment/wind-direction');
  await checkApi('https://api.data.gov.sg/v1/environment/pm25');
  
  await checkApi('https://api-open.data.gov.sg/v2/real-time/api/wind-speed');
  await checkApi('https://api-open.data.gov.sg/v2/real-time/api/pm25');
}

main();
