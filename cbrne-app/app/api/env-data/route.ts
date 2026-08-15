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
      const { fetchPm25DataWithFallback } = await import('@/lib/env-data');
      const { data, timestamp } = await fetchPm25DataWithFallback();
      return NextResponse.json({ data, timestamp });

    } else {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('API /env-data error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
