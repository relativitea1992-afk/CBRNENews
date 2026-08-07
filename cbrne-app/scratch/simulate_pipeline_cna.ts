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

function linkifyCoordinates(text: string) {
  // Matches [Station Name](MAP:Lat,Lng) and converts to <a href="...">Station Name</a>
  let linked = text.replace(/\[([^\]]+)\]\(MAP:\s*([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*)\)/gi, '<a href="https://www.google.com/maps/search/?api=1&query=$2,$3">$1</a>');
  // Fallback to strip out raw Lat/Lng if the model forgets the format
  linked = linked.replace(/\(Lat:\s*[+-]?\d+\.?\d*,\s*Lng:\s*[+-]?\d+\.?\d*\)/gi, '');
  return linked;
}

async function main() {
  console.log('Simulating complete pipeline for CNA Haze Alert article...');
  
  const article = {
    title: 'Singapore ready to roll out haze response plans as ASEAN monitoring centre raises alert level',
    content: 'The ASEAN Specialised Meteorological Centre on Monday raised the alert to Level 2, the second-highest level, signalling an increasing risk of transboundary haze in the region. Minister for Sustainability and the Environment Grace Fu said the inter-agency haze task force is coordinating action plans. Transboundary haze from forest fires in Indonesia typically affects Singapore during the dry season.',
    url: 'https://www.channelnewsasia.com/singapore/haze-alert-level-masks-task-force-6301091?ts=' + Date.now(),
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
          ? `\n<b>Tokens Consumed:</b> ${triage.usageMetadata.totalTokenCount} [In: ${triage.usageMetadata.promptTokenCount}, Out: ${triage.usageMetadata.candidatesTokenCount}]`
          : '';

    console.log('Sending Telegram Alert...');
    const googleMapsLink = triage.lat && triage.lng ? `\n<b>Location:</b> <a href="https://www.google.com/maps/search/?api=1&query=${triage.lat},${triage.lng}">View on Google Maps</a>` : '';

    const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨
    
<b>Headline:</b> ${escapeHtml(triage.headline)}
<b>Type:</b> ${escapeHtml(triage.type)}
<b>Source:</b> ${escapeHtml(article.source)}${googleMapsLink}

<b>Threat Assessment:</b>
${linkifyCoordinates(escapeHtml(triage.summary))}

${triage.advisory ? `<b>Advisory:</b>\n${linkifyCoordinates(escapeHtml(triage.advisory))}\n\n` : ''}<b>Model Used:</b> ${escapeHtml(triage.modelUsed || 'Unknown')}${tokenConsumptionStr}
<b>Link:</b> ${escapeHtml(article.url)}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
    console.log('Telegram Alert sent!');
  } else {
    console.log('Article deemed irrelevant by AI.');
  }
}

main().catch(console.error);
