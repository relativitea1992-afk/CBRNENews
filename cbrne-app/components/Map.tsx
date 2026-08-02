'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

// Fix Leaflet's default icon path issues in Next.js
const customIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

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
      style={{ background: '#0f172a' }} // Matches bg-slate-900
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      
      {incidents.map((incident) => {
        if (!incident.latitude || !incident.longitude) return null;
        
        let color = '#ef4444'; // default red
        if (incident.type === 'Odour') color = '#eab308'; // yellow
        if (incident.type === 'Chemical') color = '#8b5cf6'; // purple
        if (incident.type === 'Biological') color = '#22c55e'; // green
        if (incident.type === 'Nuclear' || incident.type === 'Radiological') color = '#f97316'; // orange
        if (incident.type === 'Explosive') color = '#dc2626'; // dark red

        return (
          <CircleMarker 
            key={incident.id} 
            center={[incident.latitude, incident.longitude]}
            pathOptions={{ fillColor: color, color: color, fillOpacity: 0.7 }}
            radius={8}
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
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
