import { NEA_WIND_STATIONS } from './constants';

export async function fetchWindDataWithFallback() {
  const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Singapore"}));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateParam = `${yyyy}-${mm}-${dd}`;
  
  const [speedRes, dirRes] = await Promise.all([
    fetch(`https://api.data.gov.sg/v1/environment/wind-speed?date=${dateParam}`, { next: { revalidate: 60 } }),
    fetch(`https://api.data.gov.sg/v1/environment/wind-direction?date=${dateParam}`, { next: { revalidate: 60 } })
  ]);

  const speedData = await speedRes.json();
  const dirData = await dirRes.json();

  if (!speedData.items || !dirData.items) {
    throw new Error('Invalid data from NEA');
  }

  const speedItems = speedData.items || [];
  const dirItems = dirData.items || [];
  
  // Get up to the last 5 minutes (last 5 items, assuming 1-minute intervals)
  const latestSpeedItems = speedItems.slice(-5).reverse();
  const latestDirItems = dirItems.slice(-5).reverse();
  
  const windData = NEA_WIND_STATIONS.map((station) => {
    let speed = null;
    let direction = null;

    for (const item of latestSpeedItems) {
      const reading = item.readings?.find((r: any) => r.station_id === station.id);
      if (reading?.value !== undefined && reading?.value !== null) {
        speed = reading.value;
        break;
      }
    }

    for (const item of latestDirItems) {
      const reading = item.readings?.find((r: any) => r.station_id === station.id);
      if (reading?.value !== undefined && reading?.value !== null) {
        direction = reading.value;
        break;
      }
    }
    
    return {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      speed: speed,
      direction: direction
    };
  });

  return {
    data: windData,
    timestamp: speedItems.length > 0 ? speedItems[speedItems.length - 1].timestamp : new Date().toISOString()
  };
}
