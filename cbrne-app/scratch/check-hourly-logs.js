const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // Get the last 10 hourly-report logs
  const logs = await prisma.systemLog.findMany({
    where: { jobName: 'hourly-report' },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  console.log('=== HOURLY REPORT LOGS (Last 10) ===');
  logs.forEach(l => {
    const sgTime = l.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    console.log(`${sgTime} | ${l.status} | ${(l.details || '').substring(0, 200)}`);
  });
  
  console.log('\n=== ALL LOGS IN PAST 3 HOURS ===');
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const recentLogs = await prisma.systemLog.findMany({
    where: { createdAt: { gte: threeHoursAgo } },
    orderBy: { createdAt: 'desc' }
  });
  recentLogs.forEach(l => {
    const sgTime = l.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    console.log(`${sgTime} | ${l.jobName} | ${l.status} | ${(l.details || '').substring(0, 200)}`);
  });
}

check().catch(console.error).finally(() => prisma.$disconnect());
