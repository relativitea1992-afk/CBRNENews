const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to database...');
  const inc = await prisma.incident.create({
    data: {
      headline: 'DUMMY TEST: Suspected Chemical Odour in Pasir Gudang',
      summary: 'This is a test report triggered manually. Residents reported a strong chemical smell near the industrial area. Authorities are investigating.',
      type: 'Odour',
      sourceName: 'System Test',
      sourceUrl: 'https://example.com/test',
      lat: 1.46,
      lng: 103.90,
      isRelevant: true,
      publishedAt: new Date()
    }
  });
  console.log('Inserted:', inc.id);

  console.log('Sending to Telegram...');
  const res = await fetch('https://api.telegram.org/bot8971373086:AAGzj9beme8e3cR-QVHIEbMDJWCSRDHXmlY/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: '243352759',
      text: '🚨 <b>NEW TEST ALERT DETECTED</b>\n\n<b>Headline:</b> ' + inc.headline + '\n<b>Type:</b> ' + inc.type + '\n<b>Summary:</b> ' + inc.summary + '\n\n<b>Source:</b> <a href="' + inc.sourceUrl + '">' + inc.sourceName + '</a>',
      parse_mode: 'HTML'
    })
  });
  
  if (res.ok) {
    console.log('Telegram sent successfully');
  } else {
    console.error('Telegram failed', await res.text());
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
