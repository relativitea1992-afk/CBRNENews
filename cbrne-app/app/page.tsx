import prisma from '@/lib/prisma';
import Dashboard from '@/components/Dashboard';

export const revalidate = 60; // Revalidate every 60 seconds

export default async function Home() {
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
    latitude: i.latitude ? Number(i.latitude) : null,
    longitude: i.longitude ? Number(i.longitude) : null,
    createdAt: i.createdAt.toISOString(),
  }));

  return <Dashboard incidents={serializedIncidents} />;
}
