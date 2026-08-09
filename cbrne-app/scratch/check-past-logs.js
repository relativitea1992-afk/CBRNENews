const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function checkLogs() {
  const logs = await prisma.systemLog.findMany({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  for (const log of logs) {
    console.log(`[${log.createdAt}] ${log.details}`);
  }
  
  await prisma.$disconnect();
}

checkLogs().catch(console.error);
