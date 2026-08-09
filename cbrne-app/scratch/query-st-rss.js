const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const threats = await prisma.incident.findMany({
    where: {
      isRelevant: true,
      sourceName: 'ST RSS'
    },
    orderBy: { createdAt: 'desc' },
    take: 2
  });
  
  for (const t of threats) {
    console.log(`\nHeadline: ${t.headline}`);
    console.log(`Type: ${t.type}`);
    console.log(`Lat/Lng: ${t.lat}, ${t.lng}`);
    console.log(`Advisory: ${t.advisory}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
