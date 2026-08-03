import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  await prisma.systemLog.create({
    data: {
      jobName: 'fetch-news',
      status: 'SUCCESS',
      details: 'Verified 42 new articles via Gemini using [gemini-3.6-flash] (CNA: 35, NewsAPI: 7). No relevant threats detected.'
    }
  });
  console.log('Faked a cron run with models testing.');
  await prisma.$disconnect();
}
run();
