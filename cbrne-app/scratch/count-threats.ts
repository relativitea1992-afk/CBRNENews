import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.incident.count({ 
    where: { 
      isRelevant: true,
      createdAt: { gte: twentyFourHoursAgo }
    } 
  });
  console.log('Threats count:', count);
}
main().finally(() => prisma.$disconnect());
