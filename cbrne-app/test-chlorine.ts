import { triageNewsArticle } from './lib/gemini';
import prisma from './lib/prisma';
import { sendTelegramMessage } from './lib/telegram';

async function main() {
  const article = {
    title: 'BREAKING: Massive Chlorine Leak at Pasir Gudang Industrial Area',
    content: 'A massive chlorine gas release incident has been reported at a chemical plant in Pasir Gudang, Johor. Authorities warn that strong winds are blowing the toxic gas plume directly south towards Singapore, with residents in Punggol and Sengkang advised to stay indoors and close windows.',
    url: 'https://example.com/chlorine-leak-' + Date.now(),
    source: 'Simulated CNA / NewsAPI',
    publishedAt: new Date(),
  };

  console.log('1. Passing to Gemini for triage...');
  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Gemini Result:', triage);

  if (triage && triage.isRelevant) {
    console.log('2. Saving to Database...');
    await prisma.incident.create({
      data: {
        headline: 'TEST: ' + triage.headline,
        summary: triage.summary,
        sourceUrl: article.url,
        sourceName: article.source,
        publishedAt: article.publishedAt,
        lat: triage.lat,
        lng: triage.lng,
        type: triage.type,
        isRelevant: true,
      }
    });

    console.log('3. Sending Telegram Alert...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED (SIMULATION)</b> 🚨
    
<b>Headline:</b> TEST: ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Impact Summary:</b>
${triage.summary}

<b>Link:</b> ${article.url}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng });
    console.log('Done!');
  }
}

main().catch(console.error);
