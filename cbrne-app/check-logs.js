const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const logs = await prisma.systemLog.findMany({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  console.log(logs.map(l => `${l.createdAt.toISOString()} | ${l.status} | ${l.details}`));
}

check().catch(console.error).finally(() => prisma.$disconnect());
