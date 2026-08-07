import dotenv from 'dotenv';
dotenv.config({path: '.env.local'});
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

function linkifyCoordinates(text: string) {
  let linked = text.replace(/\[([^\]]+)\]\(MAP:\s*([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*)\)/gi, '<a href="https://www.google.com/maps/search/?api=1&query=$2,$3">$1</a>');
  linked = linked.replace(/\(Lat:\s*[+-]?\d+\.?\d*,\s*Lng:\s*[+-]?\d+\.?\d*\)/gi, '');
  return linked;
}

async function main() {
  console.log('Simulating CNA RSS feed article...');
  
  const article = {
    title: 'BREAKING: Chemical Leak at Pulau Bukom Refinery, Singapore',
    content: 'A major chemical leak has been reported at the Shell refinery on Pulau Bukom, an island located south of mainland Singapore. The leak involves toxic industrial chemicals. Workers on the island have been evacuated. Given its proximity to the southern coast of Singapore, including Sentosa and the West Coast, authorities are closely monitoring the situation for potential transboundary air quality issues.',
    url: 'https://www.channelnewsasia.com/news/singapore/simulated-chemical-leak-bukom-' + Date.now(),
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
    const googleMapsLink = triage.lat && triage.lng ? `\n<b>Location:</b> <a href="https://www.google.com/maps/search/?api=1&query=${triage.lat},${triage.lng}">View on Google Maps</a>` : '';
    const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨\n\n<b>Headline:</b> ${escapeHtml(triage.headline)}\n<b>Type:</b> ${escapeHtml(triage.type)}\n<b>Source:</b> ${escapeHtml(article.source)}${googleMapsLink}\n\n<b>Threat Assessment:</b>\n${linkifyCoordinates(escapeHtml(triage.summary))}\n\n${triage.advisory ? `<b>Advisory:</b>\n${linkifyCoordinates(escapeHtml(triage.advisory))}\n\n` : ''}<b>Model Used:</b> ${escapeHtml(triage.modelUsed || 'Unknown')}${tokenConsumptionStr}<b>Link:</b> ${escapeHtml(article.url)}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
    console.log('Telegram Alert sent!');
  } else {
    console.log('Article deemed irrelevant by AI.');
  }
}

main().catch(console.error);
