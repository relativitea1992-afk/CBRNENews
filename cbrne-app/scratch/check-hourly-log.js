const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function run() {
  const log = await prisma.systemLog.findFirst({
    where: { jobName: 'hourly-report' },
    orderBy: { createdAt: 'desc' }
  });
  console.log(log);
}
run().catch(console.error).finally(() => prisma.$disconnect());
