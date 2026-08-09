async function checkGovSg() {
  const datesToTest = [
    new Date(Date.now() + 8*60*60*1000).toISOString().split('T')[0],
    new Date(Date.now() + 8*60*60*1000 - 24*60*60*1000).toISOString().split('T')[0]
  ];

  for (const dateStr of datesToTest) {
    console.log(`\nTesting Wind Speed for date: ${dateStr}`);
    try {
      const res = await fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=' + dateStr);
      console.log(`Status: ${res.status}`);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        console.log(`Data keys: ${Object.keys(json)}`);
        if (json.data) {
          console.log(`- data type: ${typeof json.data}`);
          if (json.data === null) {
            console.log(`- data is explicitly null!`);
          } else {
            console.log(`- data keys: ${Object.keys(json.data)}`);
            if (json.data.stations) {
              console.log(`- data.stations length: ${json.data.stations.length}`);
            }
            if (json.data.readings) {
              console.log(`- data.readings length: ${json.data.readings.length}`);
            }
          }
        }
        if (json.error || json.message) {
          console.log(`- Message/Error: ${json.error || json.message}`);
        }
      } catch (e) {
        console.log(`Failed to parse JSON. Raw response preview: ${text.substring(0, 100)}...`);
      }
    } catch (e) {
      console.log(`Fetch failed: ${e.message}`);
    }
  }
}

checkGovSg();
