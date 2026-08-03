import { triageNewsArticle } from './lib/gemini';
import prisma from './lib/prisma';
import { sendTelegramMessage } from './lib/telegram';

async function main() {
  console.log('0. Removing all alerts from database...');
  await prisma.incident.deleteMany({});
  console.log('Database cleared.');

  const article = {
    title: 'Simulated Catastrophic Escalation: USS Nimitz Struck at RSS Singapura',
    content: `By: CNA Digital Desk (Simulated) | Published: 03 Aug 2026, 21:46 SGT | Updated: 03 Aug 2026, 22:15 SGT
SINGAPORE — In a simulated catastrophic escalation scenario, a United States Navy Nimitz-class nuclear aircraft carrier docked at RSS Singapura (Changi Naval Base) has suffered a direct kinetic strike from a salvo of Iranian ballistic missiles. The simulated impact has resulted in a critical breach of the primary containment vessel of the ship's onboard nuclear reactors, initiating an uncontained Loss-of-Coolant Accident (LOCA). Target Coordinates: RSS Singapura – Changi Naval Base, 1° 19' 16" N, 104° 01' 33" E.Target Specifications: The deep-draft pier within the 128-hectare basin was hosting a Nimitz-class supercarrier (displacement: ~100,000 tons), powered by twin Westinghouse A4W pressurized water reactors (PWRs).Weapon System (Fictionalized): Iran`,
    url: 'https://example.com/cna-nimitz-simulation-' + Date.now(),
    source: 'CNA Digital Desk (Simulated)',
    publishedAt: new Date(),
  };

  console.log('1. Passing to Gemini for triage...');
  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Gemini Result:', triage);

  if (triage && triage.isRelevant) {
    console.log('2. Saving to Database...');
    const saved = await prisma.incident.create({
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
        modelUsed: triage.modelUsed || 'Unknown',
        isRelevant: true,
      }
    });

    console.log('3. Sending Telegram Alert...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED (SIMULATION)</b> 🚨
    
<b>Headline:</b> ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Impact Summary:</b>
${triage.summary}

${triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n\n` : ''}<b>Model Used:</b> ${triage.modelUsed || 'Unknown'}
<b>Link:</b> ${article.url}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
    console.log('Done!');
  }
}

main().catch(console.error);
