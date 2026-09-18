import { NEA_WIND_STATIONS } from './constants';

export async function fetchWindDataWithFallback() {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Singapore"}));
  let dateParam = now.toISOString().split('T')[0];

  let speedRes = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=${dateParam}`, { next: { revalidate: 60 } });
  let dirRes = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/wind-direction?date=${dateParam}`, { next: { revalidate: 60 } });
  
  let speedData = await speedRes.json();
  let dirData = await dirRes.json();

  // Fallback to yesterday if today is empty
  if ((!speedData.data?.readings || speedData.data.readings.length === 0) || (!dirData.data?.readings || dirData.data.readings.length === 0)) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    dateParam = yesterday.toISOString().split('T')[0];
    speedRes = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=${dateParam}`, { next: { revalidate: 60 } });
    dirRes = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/wind-direction?date=${dateParam}`, { next: { revalidate: 60 } });
    speedData = await speedRes.json();
    dirData = await dirRes.json();
  }

  if (!speedData.data?.readings || !dirData.data?.readings) {
    throw new Error('Invalid data from NEA (V2)');
  }

  const speedReadings = speedData.data.readings.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const dirReadings = dirData.data.readings.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const latestSpeed = speedReadings.slice(-5).reverse();
  const latestDir = dirReadings.slice(-5).reverse();
  
  // Actually, wait, the v2 API provides actual names in data.stations.
  // Instead of relying on hardcoded constants, we can just use the stations returned by the API if they match!
  const KNOWN_STATIONS = [
    "Ang Mo Kio Avenue 5", "Banyan Road", "Clementi Road", "East Coast Parkway",
    "Kim Chuan Road", "Marina Gardens Drive", "Nanyang Avenue", "Old Choa Chu Kang Road",
    "Paya Lebar Airport", "Pulau Ubin", "S23", "Scotts Road", "Semakau Island",
    "Sentosa", "Tuas South Avenue 3", "West Coast Highway", "Woodlands Avenue 9",
    "Changi Climate Station", "Seletar", "Admiralty", "Pasir Panjang", "Tengah", "Tai Seng"
  ];
  const windData = KNOWN_STATIONS.map((stationName) => {
    // Attempt to map from V2 string names to coordinates using the old constants if possible
    // Note: V2 API returns string names (e.g. "Marina Barrage"), whereas old constants had "S108".
    // Wait, the V2 API actually returns `stationId` inside `data.readings[i].data[j].stationId`! 
    // And that stationId matches `data.stations[k].id`.
    let speed = null;
    let direction = null;
    let stnId = speedData.data.stations?.find((s: any) => s.name === stationName)?.id;
    if (!stnId) stnId = dirData.data.stations?.find((s: any) => s.name === stationName)?.id;

    if (stnId) {
      for (const item of latestSpeed) {
        const reading = item.data?.find((r: any) => r.stationId === stnId);
        if (reading?.value !== undefined && reading?.value !== null) {
          speed = reading.value;
          break;
        }
      }

      for (const item of latestDir) {
        const reading = item.data?.find((r: any) => r.stationId === stnId);
        if (reading?.value !== undefined && reading?.value !== null) {
          direction = reading.value;
          break;
        }
      }
    }
    
    // Find coordinates from old constants via name matching if possible, else fallback
    const oldStation = NEA_WIND_STATIONS.find(s => s.name === stationName || s.id === stnId);
    
    return {
      id: stnId || stationName,
      name: stationName,
      lat: oldStation?.lat || 1.3521,
      lng: oldStation?.lng || 103.8198,
      speed: speed,
      direction: direction
    };
  });

  return {
    data: windData.filter((w: any) => w.lat !== 1.3521 && w.speed !== null), // filter out unmapped/offline
    timestamp: latestSpeed.length > 0 ? latestSpeed[0].timestamp : new Date().toISOString()
  };
}

export async function fetchPm25DataWithFallback() {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Singapore"}));
  let dateParam = now.toISOString().split('T')[0];

  let pm25Res = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/pm25?date=${dateParam}`, { next: { revalidate: 60 } });
  let pm25Data = await pm25Res.json();

  if (!pm25Data.data?.items || pm25Data.data.items.length === 0) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    dateParam = yesterday.toISOString().split('T')[0];
    pm25Res = await fetch(`https://api-open.data.gov.sg/v2/real-time/api/pm25?date=${dateParam}`, { next: { revalidate: 60 } });
    pm25Data = await pm25Res.json();
  }

  if (!pm25Data.data?.items || pm25Data.data.items.length === 0) {
    throw new Error('Invalid data from NEA PM2.5 (V2)');
  }

  const items = pm25Data.data.items.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const latestItem = items[items.length - 1];
  const readings = latestItem.readings.pm25_one_hourly;

  const regionCoords: Record<string, { lat: number, lng: number }> = {
    west: { lat: 1.35735, lng: 103.7 },
    national: { lat: 0, lng: 0 },
    east: { lat: 1.35735, lng: 103.94 },
    central: { lat: 1.35735, lng: 103.82 },
    south: { lat: 1.29587, lng: 103.82 },
    north: { lat: 1.41803, lng: 103.82 }
  };

  const mergedData = Object.keys(readings).filter(k => k !== 'national').map((region: string) => ({
    name: region,
    lat: regionCoords[region]?.lat || 0,
    lng: regionCoords[region]?.lng || 0,
    value: readings[region] ?? null
  }));

  return {
    data: mergedData,
    timestamp: latestItem.timestamp
  };
}
