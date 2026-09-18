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
  
  // The V2 API provides actual station locations, so we can map directly
  const windData = (speedData.data.stations || []).map((station: any) => {
    let speed = null;
    let direction = null;
    const stnId = station.id;

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
    
    return {
      id: stnId,
      name: station.name,
      lat: station.location.latitude,
      lng: station.location.longitude,
      speed: speed,
      direction: direction
    };
  });



  return {
    data: windData.filter((w: any) => w.lat !== 1.3521), // filter out unmapped stations, but keep offline ones
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
