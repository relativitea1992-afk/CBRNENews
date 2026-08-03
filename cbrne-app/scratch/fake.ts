import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  await prisma.systemLog.create({
    data: {
      jobName: 'fetch-news',
      status: 'SUCCESS',
      details: 'Verified 28 new articles via Gemini (CNA: 21, NewsAPI: 7). No relevant threats detected.'
    }
  });
  console.log('Faked a cron run for testing.');
  await prisma.$disconnect();
}
run();
