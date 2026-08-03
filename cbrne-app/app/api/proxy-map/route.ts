import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pt = searchParams.get('pt');
  
  const ptQuery = pt ? `&pt=${pt}` : '';
  const mapUrl = `https://static-maps.yandex.ru/1.x/?ll=103.8198,1.3521&z=11&l=map&lang=en_US&size=650,450${ptQuery}`;
  
  const res = await fetch(mapUrl);
  if (!res.ok) {
    return new NextResponse('Failed to fetch map', { status: res.status });
  }
  
  const arrayBuffer = await res.arrayBuffer();
  
  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
