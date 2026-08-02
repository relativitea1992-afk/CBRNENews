import { ImageResponse } from 'next/og';
import { Biohazard, Radiation, Bomb, FlaskConical, Wind } from 'lucide-react';
import React from 'react';

export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const type = searchParams.get('type');

    if (!lat || !lon) {
      return new Response('Missing lat/lon', { status: 400 });
    }

    // Fetch the yandex static map without any marker (so we place our own)
    const yandexUrl = `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=10&l=map&lang=en_US&size=600,400`;
    
    // We can fetch the image as ArrayBuffer to inline it
    const mapReq = await fetch(yandexUrl);
    if (!mapReq.ok) {
      return new Response('Failed to fetch map', { status: 500 });
    }
    const mapBuffer = await mapReq.arrayBuffer();
    const base64Map = `data:image/png;base64,${Buffer.from(mapBuffer).toString('base64')}`;

    // Determine icon
    let Icon = Wind;
    let color = '#3b82f6'; // blue
    if (type === 'Chemical') { Icon = FlaskConical; color = '#10b981'; } // green
    if (type === 'Biological') { Icon = Biohazard; color = '#8b5cf6'; } // purple
    if (type === 'Radiological') { Icon = Radiation; color = '#eab308'; } // yellow
    if (type === 'Explosive') { Icon = Bomb; color = '#ef4444'; } // red

    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '600px',
            height: '400px',
            position: 'relative',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={base64Map}
            alt="Map"
            style={{ position: 'absolute', top: 0, left: 0, width: 600, height: 400 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              backgroundColor: color,
              borderRadius: '50%',
              border: '3px solid white',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            }}
          >
            <Icon color="white" size={28} />
          </div>
        </div>
      ),
      {
        width: 600,
        height: 400,
      }
    );
  } catch (e: any) {
    console.error('OG Image generation error:', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
