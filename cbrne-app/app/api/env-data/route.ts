import { NextResponse } from 'next/server';
import { NEA_WIND_STATIONS } from '@/lib/constants';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'wind') {
      const { fetchWindDataWithFallback } = await import('@/lib/env-data');
      const { data, timestamp } = await fetchWindDataWithFallback();
      return NextResponse.json({ data, timestamp });

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
