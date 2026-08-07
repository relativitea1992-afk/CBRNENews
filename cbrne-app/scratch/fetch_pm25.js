const https = require('https');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const dateStr = new Date(Date.now() + 8*60*60*1000).toISOString().split('T')[0];
https.get(`https://api-open.data.gov.sg/v2/real-time/api/pm25?date=${dateStr}`, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const readings = json.data.readings;
    console.log("Latest reading:", JSON.stringify(readings[readings.length - 1], null, 2));
  });
}).on("error", (err) => console.log("Error: " + err.message));
