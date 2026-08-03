'use client';

import dynamic from 'next/dynamic';
import { DateTime } from 'luxon';
import { Wind, FlaskConical, Biohazard, Radiation, Bomb, Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MapWithNoSSR = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-slate-900 animate-pulse rounded-xl flex items-center justify-center text-slate-500">Initializing Map...</div>
});

interface Incident {
  id: string;
  headline: string;
  summary: string;
  type: string;
  sourceName: string;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
  isRelevant: boolean;
  createdAt: string;
  advisory: string | null;
}

const getTypeConfig = (type: string) => {
  switch (type) {
    case 'Odour': return { color: '#eab308', icon: <Wind size={16} /> }; // yellow
    case 'Chemical': return { color: '#8b5cf6', icon: <FlaskConical size={16} /> }; // purple
    case 'Biological': return { color: '#22c55e', icon: <Biohazard size={16} /> }; // green
    case 'Nuclear':
    case 'Radiological': return { color: '#f97316', icon: <Radiation size={16} /> }; // orange
    case 'Explosive': return { color: '#dc2626', icon: <Bomb size={16} /> }; // red
    default: return { color: '#ef4444', icon: <Radiation size={16} /> };
  }
};

export default function Dashboard({ incidents }: { incidents: Incident[] }) {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);

  const handleClearAlerts = async () => {
    if (!confirm('Are you sure you want to clear all active alerts?')) return;
    setIsClearing(true);
    try {
      await fetch('/api/alerts/clear', { method: 'POST' });
      router.refresh();
    } catch (error) {
      console.error('Failed to clear alerts', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="px-6 py-4 border-b border-slate-800 glass-panel sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-glow flex items-center gap-2">
            <span className="text-neon-blue">CBRNE</span> OSINT Dashboard
          </h1>
          <p className="text-sm text-slate-400">Singapore Regional Threat Intelligence</p>
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={handleClearAlerts}
            disabled={isClearing}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors disabled:opacity-50"
          >
            {isClearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            Clear Alerts
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${incidents.length > 0 ? 'bg-neon-red animate-pulse' : 'bg-green-500'}`}></div>
            <span className="text-sm font-medium">{incidents.length > 0 ? 'ACTIVE THREATS' : 'ALL CLEAR'}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row p-4 gap-4 overflow-hidden h-[calc(100vh-80px)]">
        
        {/* Left Panel: Feed */}
        <section className="w-full lg:w-1/3 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-lg font-semibold text-slate-200">Latest Alerts (24h)</h2>
            <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700">{incidents.length} Records</span>
          </div>

          {incidents.length === 0 ? (
            <div className="glass-panel p-8 text-center text-slate-400 rounded-xl flex-1 flex flex-col items-center justify-center">
              <svg className="w-12 h-12 mb-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>No threats detected in the region.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {incidents.map(incident => {
                const config = getTypeConfig(incident.type);
                return (
                  <article key={incident.id} className="glass-panel p-4 rounded-xl hover:bg-slate-800/80 transition-colors border-l-4" style={{
                    borderLeftColor: config.color
                  }}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-semibold px-2 py-1 rounded bg-slate-900 text-slate-300 flex items-center gap-1.5" style={{ color: config.color }}>
                        {config.icon}
                        {incident.type}
                      </span>
                      <time className="text-xs text-slate-500">{DateTime.fromISO(incident.createdAt).toRelative()}</time>
                    </div>
                    <h3 className="font-medium text-slate-100 mb-2 leading-snug">{incident.headline}</h3>
                    <p className="text-sm text-slate-400 mb-3 line-clamp-3">{incident.summary}</p>
                    {incident.advisory && (
                      <div className="mb-3 p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Advisory</span>
                          {(incident as any).modelUsed && (
                            <span className="text-[10px] bg-red-900/40 text-red-300 px-1.5 py-0.5 rounded border border-red-800/50">
                              Generated by {(incident as any).modelUsed}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-red-200 whitespace-pre-wrap leading-relaxed">{incident.advisory}</p>
                      </div>
                    )}
                    <a href={incident.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-neon-blue hover:text-blue-400 flex items-center gap-1 w-fit">
                      Source: {incident.sourceName} ↗
                    </a>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Panel: Map */}
        <section className="w-full lg:w-2/3 h-[50vh] min-h-[50vh] lg:h-full lg:min-h-[calc(100vh-120px)] relative rounded-xl overflow-hidden glass-panel border border-slate-700/50 shadow-lg">
          <MapWithNoSSR incidents={incidents} />
          
          {/* Map Legend Overlay */}
          <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-lg shadow-xl z-[1000] text-xs">
            <h4 className="font-semibold text-slate-200 mb-2 border-b border-slate-700 pb-1">Threat Types</h4>
            <div className="flex flex-col gap-2 text-slate-300">
              <div className="flex items-center gap-2"><span style={{ color: '#eab308' }}><Wind size={16} /></span><span>Odour</span></div>
              <div className="flex items-center gap-2"><span style={{ color: '#8b5cf6' }}><FlaskConical size={16} /></span><span>Chemical</span></div>
              <div className="flex items-center gap-2"><span style={{ color: '#22c55e' }}><Biohazard size={16} /></span><span>Biological</span></div>
              <div className="flex items-center gap-2"><span style={{ color: '#f97316' }}><Radiation size={16} /></span><span>Radiological/Nuclear</span></div>
              <div className="flex items-center gap-2"><span style={{ color: '#dc2626' }}><Bomb size={16} /></span><span>Explosive</span></div>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
