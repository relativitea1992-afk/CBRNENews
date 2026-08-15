const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function run() {
  const oneHourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const logs = await prisma.systemLog.findMany({
    where: {
      createdAt: { gte: oneHourAgo }
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log(JSON.stringify(logs, null, 2));
}
run().catch(console.error).finally(() => prisma.$disconnect());
