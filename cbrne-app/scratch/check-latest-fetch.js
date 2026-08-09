const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recentFetch = await prisma.systemLog.findFirst({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' }
  });
  
  if (recentFetch) {
    console.log("Latest fetch-news log:");
    console.log(`Time: ${recentFetch.createdAt}`);
    console.log(`Status: ${recentFetch.status}`);
    console.log(`Details: ${recentFetch.details}`);
  } else {
    console.log("No recent fetch-news logs found.");
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
