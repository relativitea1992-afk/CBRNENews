const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { triageNewsArticle } = require('./lib/gemini');
const { sendTelegramMessage } = require('./lib/telegram');

async function simulate() {
  const article = {
    title: 'BREAKING: US Aircraft Carrier Strike at Changi Naval Base',
    content: `SINGAPORE — In a simulated catastrophic escalation scenario, a United States Navy Nimitz-class nuclear aircraft carrier docked at RSS Singapura (Changi Naval Base) has suffered a direct kinetic strike from a salvo of Iranian ballistic missiles. The simulated impact has resulted in a critical breach of the primary containment vessel of the ship's onboard nuclear reactors, initiating an uncontained Loss-of-Coolant Accident (LOCA). Target Coordinates: RSS Singapura – Changi Naval Base, 1° 19' 16" N, 104° 01' 33" E.Target Specifications: The deep-draft pier within the 128-hectare basin was hosting a Nimitz-class supercarrier (displacement: ~100,000 tons), powered by twin Westinghouse A4W pressurized water reactors (PWRs).Weapon System (Fictionalized): Iranian aerospace forces utilized an unprecedented intercontinental-range variant of the Kheibar (Khorramshahr-4) ballistic missile architecture. The simulated payload delivered a 1,500 kg high-explosive conventional warhead traveling at terminal hypersonic velocities (Mach 8+).`,
    url: 'https://www.channelnewsasia.com/simulated-strike-changi-naval-base-' + Date.now(),
    source: 'CNA Digital Desk (Simulated)',
    publishedAt: new Date('2026-08-03T21:46:00+08:00')
  };
  
  console.log('Sending to Gemini for triage...');
  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Gemini Triage Result:', JSON.stringify(triage, null, 2));
  
  if (triage && triage.isRelevant) {
    console.log('Saving to DB...');
    await prisma.incident.create({
      data: {
        headline: triage.headline,
        summary: triage.summary,
        sourceUrl: article.url,
        sourceName: article.source,
        publishedAt: article.publishedAt,
        lat: triage.lat,
        lng: triage.lng,
        type: triage.type,
        advisory: triage.advisory,
        isRelevant: true,
      }
    });
    
    console.log('Sending to Telegram...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨\n\n` +
      `<b>Headline:</b> ${triage.headline}\n` +
      `<b>Type:</b> ${triage.type}\n` +
      `<b>Source:</b> ${article.source}\n\n` +
      `<b>Impact Summary:</b>\n` +
      `${triage.summary}\n\n` +
      (triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n\n` : '') +
      `<b>Link:</b> ${article.url}`;
      
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
    console.log('Done!');
  } else {
    console.log('Article deemed not relevant by Gemini.');
  }
}

simulate().catch(console.error).finally(() => prisma.$disconnect());
