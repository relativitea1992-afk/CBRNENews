
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const lastRun = await prisma.systemLog.findFirst({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' }
  });
  console.log(lastRun.details || lastRun.status);
}
main().catch(console.error).finally(() => prisma.$disconnect());

