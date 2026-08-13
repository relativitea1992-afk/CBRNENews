import { NextResponse } from 'next/server';
import { NEA_WIND_STATIONS } from '@/lib/constants';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'wind') {
      // Fetch wind speed and direction in parallel
      const [speedRes, dirRes] = await Promise.all([
        fetch('https://api.data.gov.sg/v1/environment/wind-speed', { next: { revalidate: 60 } }),
        fetch('https://api.data.gov.sg/v1/environment/wind-direction', { next: { revalidate: 60 } })
      ]);

      const speedData = await speedRes.json();
      const dirData = await dirRes.json();

      if (!speedData.items || !dirData.items) {
        return NextResponse.json({ error: 'Invalid data from NEA' }, { status: 500 });
      }

      const speedReadings = speedData.items[0].readings || [];
      const dirReadings = dirData.items[0].readings || [];

      // Merge data using master list so offline stations are still returned with null values
      const windData = NEA_WIND_STATIONS.map((station) => {
        const speed = speedReadings.find((r: any) => r.station_id === station.id)?.value ?? null;
        const direction = dirReadings.find((r: any) => r.station_id === station.id)?.value ?? null;
        
        return {
          id: station.id,
          name: station.name,
          lat: station.lat,
          lng: station.lng,
          speed: speed, // knots or knots-equivalent, api doesn't specify unit, usually knots
          direction: direction // degrees
        };
      });

      return NextResponse.json({ data: windData, timestamp: speedData.items[0].timestamp });

    } else if (type === 'pm25') {
      const pm25Res = await fetch('https://api.data.gov.sg/v1/environment/pm25', { next: { revalidate: 60 } });
      const pm25Data = await pm25Res.json();

      if (!pm25Data.items) {
         return NextResponse.json({ error: 'Invalid data from NEA' }, { status: 500 });
      }

      const regions = pm25Data.region_metadata;
      const readings = pm25Data.items[0].readings.pm25_one_hourly;

      const mergedData = regions.map((region: any) => ({
        name: region.name, // east, west, north, south, central
        lat: region.label_location.latitude,
        lng: region.label_location.longitude,
        value: readings[region.name] ?? null
      }));

      return NextResponse.json({ data: mergedData, timestamp: pm25Data.items[0].timestamp });

    } else {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('API /env-data error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
