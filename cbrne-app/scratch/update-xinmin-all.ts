import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.incident.updateMany({
    where: {
      summary: {
        contains: 'Xinmin'
      }
    },
    data: {
      lat: 1.37243,
      lng: 103.883092
    }
  });

  console.log(`Updated ${updated.count} incidents to the correct coordinates.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
