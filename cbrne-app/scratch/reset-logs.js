const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.systemLog.count();
  console.log(`Found ${count} SystemLog entries.`);
  
  const result = await prisma.systemLog.deleteMany({});
  console.log(`Deleted ${result.count} SystemLog entries.`);
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
