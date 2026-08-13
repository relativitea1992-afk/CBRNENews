'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Wind, FlaskConical, Biohazard, Radiation, Bomb, CloudFog, Navigation, Activity } from 'lucide-react';

type Incident = {
  id: string;
  headline: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
  type: string;
  createdAt: string;
};

function MapFix() {
  const map = useMap();
  useEffect(() => {
    // Invalidate size repeatedly to handle headless browser rendering quirks where container size changes
    const timers = [100, 500, 1000, 2500, 4000].map(ms => 
      setTimeout(() => { map.invalidateSize(); }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
}

export default function Map({ 
  incidents, 
  windData = [], 
  pm25Data = [], 
  showWind = false, 
  showPm25 = false,
  windError = null,
  pm25Error = null
}: { 
  incidents: Incident[], 
  windData?: any[], 
  pm25Data?: any[], 
  showWind?: boolean, 
  showPm25?: boolean,
  windError?: string | null,
  pm25Error?: string | null
}) {
  const [mounted, setMounted] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const searchParams = useSearchParams();
  const isSnapshot = searchParams.get('snapshot') === 'true';

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="absolute inset-0 bg-slate-900 animate-pulse rounded-xl border border-slate-700"></div>;

  const center: [number, number] = [1.3521, 103.8198]; // Singapore center
  
  const tileUrl = isSnapshot 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
    : "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
    
  const attribution = isSnapshot
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://maps.google.com">Google Maps</a>';

  if (isSnapshot) {
    const ptParam = incidents
      .filter(i => i.latitude && i.longitude)
      .map(i => {
        let color = 'pm2rdm'; // default red
        if (i.type === 'Odour') color = 'pm2ylm';
        else if (i.type === 'Chemical') color = 'pm2vvm';
        else if (i.type === 'Biological') color = 'pm2grm';
        else if (i.type === 'Nuclear' || i.type === 'Radiological') color = 'pm2orm';
        else if (i.type === 'Explosive') color = 'pm2rdm';
        else if (i.type === 'Haze / Air Quality') color = 'pm2bwm';
        return `${i.longitude},${i.latitude},${color}`;
      })
      .join('~');
    
    const ptQuery = ptParam ? `&pt=${ptParam}` : '';
    const staticMapUrl = `https://static-maps.yandex.ru/1.x/?ll=103.8198,1.3521&z=11&l=map&lang=en_US&size=650,450${ptQuery}`;
    
    return (
      <div className="absolute inset-0 z-0 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
           src={staticMapUrl} 
           alt="Static Map" 
           style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
           onLoad={() => setIsImageLoaded(true)} 
           onError={(e) => {
             console.error('Static map failed to load', e);
             setIsImageLoaded(true); // Fallback so we don't timeout forever
           }} 
        />
        {isImageLoaded && <div id="map-ready" className="hidden"></div>}
      </div>
    );
  }

  return (
    <MapContainer 
      center={center} 
      zoom={11} 
      scrollWheelZoom={true} 
      className="absolute inset-0 z-0 rounded-xl"
      style={{ height: '100%', width: '100%', background: '#0f172a' }} // Matches bg-slate-900
    >
      <MapFix />
      <TileLayer
        attribution={attribution}
        url={tileUrl}
      />
      
      {incidents.map((incident) => {
        if (!incident.latitude || !incident.longitude) return null;
        
        let color = '#ef4444'; // default red
        let IconComp = Radiation;
        if (incident.type === 'Odour') { color = '#eab308'; IconComp = Wind; }
        else if (incident.type === 'Chemical') { color = '#8b5cf6'; IconComp = FlaskConical; }
        else if (incident.type === 'Biological') { color = '#22c55e'; IconComp = Biohazard; }
        else if (incident.type === 'Nuclear' || incident.type === 'Radiological') { color = '#f97316'; IconComp = Radiation; }
        else if (incident.type === 'Explosive') { color = '#dc2626'; IconComp = Bomb; }
        else if (incident.type === 'Haze / Air Quality') { color = '#d97706'; IconComp = CloudFog; }

        const iconHtml = renderToString(
          <div style={{
            backgroundColor: color,
            color: 'white',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
            border: '2px solid white'
          }}>
            <IconComp size={18} />
          </div>
        );

        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-leaflet-icon',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16]
        });

        return (
          <Marker 
            key={incident.id} 
            position={[incident.latitude, incident.longitude]}
            icon={customIcon}
          >
            <Popup className="bg-slate-800 text-white rounded-md border-none">
              <div className="p-2 max-w-xs text-slate-800">
                <h3 className="font-bold text-lg mb-1">{incident.headline}</h3>
                <span className="inline-block px-2 py-1 bg-slate-100 rounded text-xs font-semibold text-slate-700 mb-2">{incident.type}</span>
                <p className="text-sm mb-2">{incident.summary}</p>
                <div className="flex justify-between items-center text-xs text-slate-500">
                   <span>{incident.sourceName}</span>
                   <a href={incident.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Read Source</a>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {/* Environmental Data Overlays */}
      {showWind && windData.map((station) => {
        if (!station.lat || !station.lng) return null;
        
        const arrowHtml = renderToString(
          <div style={{
            transform: `rotate(${station.direction || 0}deg)`,
            color: '#22d3ee', // cyan-400
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            textShadow: '0 0 5px rgba(0,0,0,0.8)'
          }}>
            <Navigation size={24} fill="#0891b2" />
          </div>
        );

        const arrowIcon = L.divIcon({
          html: arrowHtml,
          className: 'custom-wind-icon bg-transparent border-none',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -12]
        });

        return (
          <Marker 
            key={`wind-${station.id}`} 
            position={[station.lat, station.lng]}
            icon={arrowIcon}
          >
            <Popup className="bg-slate-800 text-white rounded-md border-none">
              <div className="p-2 max-w-xs text-slate-800">
                <h3 className="font-bold text-sm mb-1">{station.name}</h3>
                <p className="text-xs">Speed: {station.speed !== null ? `${station.speed} knots` : 'N/A'}</p>
                <p className="text-xs">Direction: {station.direction !== null ? `${station.direction}°` : 'N/A'}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {showPm25 && pm25Data.map((region) => {
        if (!region.lat || !region.lng) return null;
        
        let color = '#22c55e'; // Green (Normal 0-55)
        if (region.value > 250) color = '#dc2626'; // Red (Very High)
        else if (region.value > 150) color = '#f97316'; // Orange (High)
        else if (region.value > 55) color = '#eab308'; // Yellow (Elevated)

        return (
          <CircleMarker
            key={`pm25-${region.name}`}
            center={[region.lat, region.lng]}
            pathOptions={{ color: color, fillColor: color, fillOpacity: 0.5, weight: 2 }}
            radius={25}
          >
            <Popup className="bg-slate-800 text-white rounded-md border-none">
              <div className="p-2 max-w-xs text-slate-800">
                <h3 className="font-bold text-sm mb-1 capitalize">{region.name} Region</h3>
                <p className="text-xs font-semibold">PM2.5: {region.value !== null ? region.value : 'N/A'}</p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Control Panel Overlay for Status Lists */}
      {(showWind || showPm25) && (
        <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur border border-slate-700 p-4 rounded-lg shadow-xl z-[1000] w-64 max-h-[60vh] overflow-y-auto custom-scrollbar">
          
          {showWind && (
            <div className="mb-4">
              <h4 className="font-semibold text-cyan-400 mb-2 border-b border-slate-700 pb-1 sticky top-0 bg-slate-900/95 flex items-center gap-1">
                <Navigation size={14} /> NEA Weather Stations
              </h4>
              {windError ? (
                <p className="text-xs text-red-400">{windError}</p>
              ) : windData.length === 0 ? (
                <p className="text-xs text-slate-400">Loading...</p>
              ) : (
                <ul className="text-xs space-y-1.5 text-slate-300">
                  {windData.map(s => (
                    <li key={s.id} className="flex justify-between items-center bg-slate-800/50 p-1.5 rounded">
                      <span className="truncate w-3/5" title={s.name}>{s.name}</span>
                      <span className="w-2/5 text-right font-mono text-[10px]">
                        {s.speed !== null ? `${s.speed}kts` : '-'} {s.direction !== null ? `${s.direction}°` : '-'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {showPm25 && (
            <div>
              <h4 className="font-semibold text-amber-400 mb-2 border-b border-slate-700 pb-1 sticky top-0 bg-slate-900/95 flex items-center gap-1">
                <Activity size={14} /> Gov.sg PM2.5 Regions
              </h4>
              {pm25Error ? (
                <p className="text-xs text-red-400">{pm25Error}</p>
              ) : pm25Data.length === 0 ? (
                <p className="text-xs text-slate-400">Loading...</p>
              ) : (
                <ul className="text-xs space-y-1.5 text-slate-300">
                  {pm25Data.map(r => {
                    let dotColor = 'bg-green-500';
                    if (r.value > 250) dotColor = 'bg-red-500';
                    else if (r.value > 150) dotColor = 'bg-orange-500';
                    else if (r.value > 55) dotColor = 'bg-yellow-500';
                    return (
                      <li key={r.name} className="flex justify-between items-center bg-slate-800/50 p-1.5 rounded">
                        <span className="capitalize flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
                          {r.name}
                        </span>
                        <span className="font-mono font-bold text-slate-200">{r.value !== null ? r.value : '-'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

    </MapContainer>
  );
}
