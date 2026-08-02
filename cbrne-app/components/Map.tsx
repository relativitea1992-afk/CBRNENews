'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Wind, FlaskConical, Biohazard, Radiation, Bomb } from 'lucide-react';

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

export default function Map({ incidents }: { incidents: Incident[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="absolute inset-0 bg-slate-900 animate-pulse rounded-xl border border-slate-700"></div>;

  const center: [number, number] = [1.3521, 103.8198]; // Singapore center

  return (
    <MapContainer 
      center={center} 
      zoom={11} 
      scrollWheelZoom={true} 
      className="absolute inset-0 z-0 rounded-xl"
      style={{ height: '100%', width: '100%', background: '#0f172a' }} // Matches bg-slate-900
    >
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
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
    </MapContainer>
  );
}
