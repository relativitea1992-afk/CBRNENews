import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const incidents = await prisma.incident.findMany({
    where: {
      type: {
        contains: 'Haze'
      }
    },
    orderBy: { publishedAt: 'desc' },
    take: 20
  });

  console.log("Found Haze incidents:", incidents.length);
  for (const inc of incidents) {
    console.log(`- ID: ${inc.id}, ClusterID: ${inc.clusterId}, PublishedAt: ${inc.publishedAt}, CreatedAt: ${inc.createdAt}, Headline: ${inc.headline}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
