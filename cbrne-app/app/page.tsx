import prisma from '@/lib/prisma';
import Dashboard from '@/components/Dashboard';
import { NEA_WIND_STATIONS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function Home(
  props: { searchParams?: Promise<{ snapshot?: string, pm25?: string, wind?: string }> | { snapshot?: string, pm25?: string, wind?: string } }
) {
  // In newer Next.js versions searchParams might be a Promise
  const searchParams = await props.searchParams;
  const isSnapshot = searchParams?.snapshot === 'true';
  const isPm25Snapshot = searchParams?.pm25 === 'true';
  const isWindSnapshot = searchParams?.wind === 'false' ? false : true;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const incidents = await prisma.incident.findMany({
    where: {
      isRelevant: true,
      createdAt: { gte: oneDayAgo }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Serialize dates to ISO strings for the client component
  const serializedIncidents = incidents.map(i => ({
    ...i,
    latitude: i.lat ? Number(i.lat) : null,
    longitude: i.lng ? Number(i.lng) : null,
    createdAt: i.createdAt.toISOString(),
  }));

  let initialWindData: any[] = [];
  let initialPm25Data: any[] = [];
  if (isSnapshot) {
    try {
      const { fetchWindDataWithFallback, fetchPm25DataWithFallback } = await import('@/lib/env-data');
      if (isWindSnapshot) {
        const { data: windData } = await fetchWindDataWithFallback();
        initialWindData = windData;
      }
      
      if (isPm25Snapshot) {
        const { data: pm25Data } = await fetchPm25DataWithFallback();
        initialPm25Data = pm25Data;
      }
    } catch (e) {
      console.error('Failed to fetch initial env data for snapshot', e);
    }
  }

  return <Dashboard incidents={serializedIncidents} isSnapshot={isSnapshot} isPm25Snapshot={isPm25Snapshot} isWindSnapshot={isWindSnapshot} initialWindData={initialWindData} initialPm25Data={initialPm25Data} />;
}
