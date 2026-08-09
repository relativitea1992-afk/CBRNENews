const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function run() {
  const logs = await prisma.systemLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log(logs.map(l => `${l.jobName} @ ${l.createdAt}`));
}
run().catch(console.error).finally(() => prisma.$disconnect());
