const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function checkLogs() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const logs = await prisma.systemLog.findMany({
    where: { 
      jobName: 'fetch-news',
      createdAt: { gte: oneHourAgo }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log(`Found ${logs.length} fetch-news logs in the past hour.`);
  for (const log of logs) {
    console.log(`[${log.createdAt}] ${log.status} - ${log.details}`);
  }
  
  await prisma.$disconnect();
}

checkLogs().catch(console.error);
