import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const incidents = await prisma.incident.findMany({
    where: {
      summary: {
        contains: 'Xinmin'
      }
    }
  });

  console.log('Found incidents:', incidents.length);
  incidents.forEach((inc, index) => {
    console.log(`[${index}] ID: ${inc.id}, lat: ${inc.lat}, lng: ${inc.lng}, Source: ${inc.sourceName}, Title: ${inc.headline}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
