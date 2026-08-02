import { triageNewsArticle } from './lib/gemini';
import prisma from './lib/prisma';
import { sendTelegramMessage } from './lib/telegram';

async function main() {
  console.log('0. Removing all alerts from database...');
  await prisma.incident.deleteMany({});
  console.log('Database cleared.');

  const article = {
    title: 'Chemical leak involving spent inorganic acid detected in Pasir Gudang',
    content: `PASIR GUDANG - A chemical leak involving a tank containing spent inorganic acid has been detected at a factory in the Pasir Gudang Industrial Area in Johor.

A Johor Fire and Rescue Department spokesman said they received a report about the incident at a factory located on Jalan Keluli .

“A team from the Pasir Gudang Fire and Rescue Station was dispatched to the scene and arrived at 12.08am.

“Firefighters found that a 20000 litre industrial tank containing spent inorganic acid, classified as scheduled waste, had developed a leak,” he said.

The spokesman added the operation was carried out in collaboration with the Environment Department and firefighters monitored the situation to ensure public and environmental safety.

The Fire Department said factory management transferred remaining chemical waste into a scrubber to prevent further release of harzardous substances.

“The situation was currently still not under control and multiple injuries were reported. Johor authorities has initiated mass evacuation of surrounding areas and metereological reports have reported strong winds towards punggol direction in singapore`,
    url: 'https://example.com/cna-chemical-leak-' + Date.now(),
    source: 'CNA / Multiple News APIs',
    publishedAt: new Date(),
  };

  console.log('1. Passing to Gemini for triage...');
  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Gemini Result:', triage);

  if (triage && triage.isRelevant) {
    console.log('2. Saving to Database...');
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

    console.log('3. Sending Telegram Alert...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED (SIMULATION)</b> 🚨
    
<b>Headline:</b> ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Impact Summary:</b>
${triage.summary}

${triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n` : ''}
<b>Link:</b> ${article.url}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng });
    console.log('Done!');
  }
}

main().catch(console.error);
