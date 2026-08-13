import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const incident = await prisma.incident.findFirst({
    where: {
      headline: {
        contains: 'Xinmin Secondary School'
      }
    }
  });

  if (incident) {
    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: {
        lat: 1.37243,
        lng: 103.883092,
        summary: incident.summary?.replace('MAP:1.3521,103.8198', 'MAP:1.37243,103.883092')
      }
    });
    console.log('Updated:', updated);
  } else {
    console.log('Incident not found. Looking by summary...');
    const incidentBySummary = await prisma.incident.findFirst({
      where: {
        summary: {
          contains: 'Xinmin Secondary School'
        }
      }
    });
    if (incidentBySummary) {
      const updated = await prisma.incident.update({
        where: { id: incidentBySummary.id },
        data: {
          lat: 1.37243,
          lng: 103.883092,
          summary: incidentBySummary.summary?.replace('MAP:1.3521,103.8198', 'MAP:1.37243,103.883092')
        }
      });
      console.log('Updated:', updated);
    } else {
        console.log('Still not found');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
