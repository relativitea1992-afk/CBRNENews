import prisma from '@/lib/prisma';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Home(
  props: { searchParams?: Promise<{ snapshot?: string }> | { snapshot?: string } }
) {
  // In newer Next.js versions searchParams might be a Promise
  const searchParams = await props.searchParams;
  const isSnapshot = searchParams?.snapshot === 'true';
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

  return <Dashboard incidents={serializedIncidents} isSnapshot={isSnapshot} />;
}
