import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  await prisma.systemLog.deleteMany();
  console.log('Cleared all system logs.');
  await prisma.$disconnect();
}
run();
