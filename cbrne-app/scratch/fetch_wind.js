const fs = require('fs');
async function fetchWind() {
  const speedRes = await fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed');
  const speedData = await speedRes.json();
  const dirRes = await fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-direction');
  const dirData = await dirRes.json();
  console.log(JSON.stringify({ speed: speedData.data.readings[0], dir: dirData.data.readings[0] }, null, 2));
}
fetchWind().catch(console.error);
