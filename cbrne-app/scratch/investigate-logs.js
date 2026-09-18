// Focused investigation on the 2 zero-token reports and their surrounding context
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check the two zero-token reports in detail
  const zeroTokenDates = [
    { start: new Date('2026-09-15T14:00:00Z'), end: new Date('2026-09-16T02:00:00Z'), label: 'Sept 15-16 Zero Token Window' },
  ];
  
  for (const { start, end, label } of zeroTokenDates) {
    console.log(`\n=== ${label} ===`);
    const logs = await prisma.systemLog.findMany({
      where: {
        createdAt: { gte: start, lte: end }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    for (const log of logs) {
      const dateStr = log.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const shortDetail = (log.details || '').substring(0, 250);
      console.log(`  [${dateStr}] ${log.jobName} ${log.status}`);
      console.log(`    ${shortDetail}`);
      console.log();
    }
  }

  // Also check Sept 11 around 21:00 SGT (the missing gap)
  console.log(`\n=== SEPT 11 MISSING GAP (20:00-22:00 SGT) ===`);
  const sept11Start = new Date('2026-09-11T12:00:00Z'); // 20:00 SGT
  const sept11End = new Date('2026-09-11T14:30:00Z');   // 22:30 SGT
  const sept11Logs = await prisma.systemLog.findMany({
    where: {
      createdAt: { gte: sept11Start, lte: sept11End }
    },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`Logs around the gap:`);
  for (const log of sept11Logs) {
    const dateStr = log.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const shortDetail = (log.details || '').substring(0, 250);
    console.log(`  [${dateStr}] ${log.jobName} ${log.status}`);
    console.log(`    ${shortDetail}`);
    console.log();
  }

  // Now let's trace the code path that leads to "0 tokens" with "Unknown" model
  // This means geminiGenerate was likely never called, or the metrics variables 
  // remained at their default values (0 and 'Unknown')
  
  // Check: were there fetch-news errors around the zero-token times?
  console.log(`\n=== FETCH-NEWS STATUS AROUND ZERO-TOKEN TIMES ===`);
  
  // Sept 15, 11:05 PM SGT = Sept 15, 15:05 UTC
  const z1Start = new Date('2026-09-15T14:00:00Z');
  const z1End = new Date('2026-09-15T16:00:00Z');
  const z1Logs = await prisma.systemLog.findMany({
    where: {
      jobName: 'fetch-news',
      createdAt: { gte: z1Start, lte: z1End }
    },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`\nFetch-news logs around Sept 15, 11 PM SGT:`);
  for (const log of z1Logs) {
    const dateStr = log.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    console.log(`  [${dateStr}] ${log.status}: ${(log.details || '').substring(0, 200)}`);
  }

  // Sept 16, 12:06 AM SGT = Sept 15, 16:06 UTC
  const z2Start = new Date('2026-09-15T15:00:00Z');
  const z2End = new Date('2026-09-15T17:00:00Z');
  const z2Logs = await prisma.systemLog.findMany({
    where: {
      jobName: 'fetch-news',
      createdAt: { gte: z2Start, lte: z2End }
    },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`\nFetch-news logs around Sept 16, 12 AM SGT:`);
  for (const log of z2Logs) {
    const dateStr = log.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    console.log(`  [${dateStr}] ${log.status}: ${(log.details || '').substring(0, 200)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Query failed:', e.message);
  process.exit(1);
});
