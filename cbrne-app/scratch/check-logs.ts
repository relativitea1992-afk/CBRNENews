import prisma from '../lib/prisma';

async function checkLogs() {
  const today = new Date('2026-08-07T00:00:00+08:00');
  const logs = await prisma.systemLog.findMany({
    where: {
      createdAt: { gte: today }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log("=== TODAY'S LOGS ===");
  logs.forEach(log => {
    console.log(`[${log.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}] ${log.jobName} - ${log.status}`);
  });
}

checkLogs()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
