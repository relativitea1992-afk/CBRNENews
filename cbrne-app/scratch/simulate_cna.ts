require('dotenv').config({path: '.env.local'});
import { triageNewsArticle } from '../lib/gemini';
import { sendTelegramMessage } from '../lib/telegram';
import prisma from '../lib/prisma';

function escapeHtml(unsafe: any) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  console.log('Simulating CNA RSS feed article...');
  
  const article = {
    title: 'BREAKING: Massive Chemical Leak at Pasir Gudang Industrial Area, Toxic Fumes Heading South',
    content: 'A major chemical leak involving a highly toxic and flammable industrial solvent has been reported at a chemical processing plant in Pasir Gudang, Johor, just across the strait from Singapore. Emergency responders have ordered immediate evacuations of the surrounding 5km radius. Prevailing northerly winds are currently carrying a thick, acrid plume of toxic gas directly towards the northern coast of Singapore, particularly threatening Punggol and Sembawang. Residents report strong chemical odours and eye irritation. Authorities warn residents to stay indoors and seek medical attention if experiencing respiratory distress.',
    url: 'https://www.channelnewsasia.com/news/singapore/simulated-chemical-leak-' + Date.now(),
    source: 'CNA',
    publishedAt: new Date()
  };

  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Triage Result:', JSON.stringify(triage, null, 2));

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
        modelUsed: triage.modelUsed || 'Unknown',
        isRelevant: true,
      }
    });

    const tokenConsumptionStr = triage.usageMetadata 
          ? `\n<b>Tokens Consumed:</b> ${triage.usageMetadata.totalTokenCount} [In: ${triage.usageMetadata.promptTokenCount}, Out: ${triage.usageMetadata.candidatesTokenCount}]\n`
          : '\n';

    console.log('Sending Telegram Alert...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨\n\n<b>Headline:</b> ${escapeHtml(triage.headline)}\n<b>Type:</b> ${escapeHtml(triage.type)}\n<b>Source:</b> ${escapeHtml(article.source)}\n\n<b>Threat Assessment:</b>\n${escapeHtml(triage.summary)}\n\n${triage.advisory ? `<b>Advisory:</b>\n${escapeHtml(triage.advisory)}\n\n` : ''}<b>Model Used:</b> ${escapeHtml(triage.modelUsed || 'Unknown')}${tokenConsumptionStr}<b>Link:</b> ${escapeHtml(article.url)}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
    console.log('Telegram Alert sent!');
  } else {
    console.log('Article deemed irrelevant by AI.');
  }
}

main().catch(console.error);
