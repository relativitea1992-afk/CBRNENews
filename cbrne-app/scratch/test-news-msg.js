const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function run() {
  const oneHourAgoLog = new Date(Date.now() - 60 * 60 * 1000);
  const recentRuns = await prisma.systemLog.findMany({
    where: { 
      jobName: 'fetch-news',
      createdAt: { gte: oneHourAgoLog }
    },
    orderBy: { createdAt: 'desc' },
    take: 2
  });
  
  const escapeHtml = (unsafe) => {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
  };

  if (recentRuns.length > 0) {
    let checkedLines = '';
    for (let i = 0; i < recentRuns.length; i++) {
      const run = recentRuns[i];
      let outcome = run.details || run.status;
      
      outcome = outcome.replace(/ \| Models: .*? \| Ingress: \d+ bytes/g, '');
      outcome = outcome.replace(/ \| Models: [^|]+/g, '');
      outcome = outcome.replace(/ \| Ingress: \d+ bytes/g, '');
      outcome = outcome.replace(/ \| Egress: \d+ bytes/g, '');

      outcome = outcome.replace(/\(([^)]+)\)/, (match, inner) => {
        if (inner.includes(':')) {
          const parts = inner.split(', ');
          const consolidated = {};
          for (const part of parts) {
            const [src, count] = part.split(': ');
            if (src && count) {
              const key = (src === 'CNA' || src === 'ST') ? src : 'NewsAPI';
              consolidated[key] = (consolidated[key] || 0) + parseInt(count);
            }
          }
          const result = Object.entries(consolidated).map(([s, c]) => `${s}: ${c}`).join(', ');
          return `(${result})`;
        }
        return match;
      });

      outcome = escapeHtml(outcome);
      outcome = outcome.replace(/ via /g, '\nProcessed via ')
                       .replace(/ \| Tokens Consumed:/g, '\nTokens Consumed:')
                       .replace(/\. Found/g, '.\nFound')
                       .replace(/\. No relevant threats/g, '.\nNo relevant threats')
                       .replace(/\. Threats detected!/g, '.\nThreats detected!');
      const icon = run.status === 'SUCCESS' ? '✅' : '❌';
      checkedLines += `${icon} <b>News Fetched:</b> ${run.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${outcome}\n\n`;
    }
    console.log(checkedLines.trim());
  } else {
    console.log('⚠️ <i>Background `fetch-news` cron job has not run in the past hour.</i>');
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
