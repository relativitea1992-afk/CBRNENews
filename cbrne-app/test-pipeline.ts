import { PrismaClient } from '@prisma/client';
import { triageNewsArticle } from './lib/gemini';

const prisma = new PrismaClient();

async function main() {
  const fakeArticle = `BREAKING: A massive chemical spill has been reported at an industrial facility in Johor Bahru, Malaysia, just across the strait from Singapore. Residents in Woodlands, Singapore, are reporting a strong, pungent odour resembling ammonia. Authorities in both Malaysia and Singapore are on high alert. The incident occurred near the coordinates 1.4927, 103.7414. SCDF is monitoring the air quality closely.`;
  
  console.log('Sending fake article to Gemini AI for triage...');
  const result = await triageNewsArticle(fakeArticle);
  
  console.log('Gemini Result:', result);
  
  if (result && result.isRelevant) {
    console.log('Incident is relevant! Saving to database...');
    const inc = await prisma.incident.create({
      data: {
        headline: result.headline,
        summary: result.summary,
        type: result.type,
        sourceName: 'Simulated News Report',
        sourceUrl: 'https://example.com/simulated',
        lat: result.lat,
        lng: result.lng,
        isRelevant: true,
        publishedAt: new Date()
      }
    });
    console.log('Inserted into DB:', inc.id);
    
    console.log('Sending Telegram alert...');
    const res = await fetch('https://api.telegram.org/bot8971373086:AAGzj9beme8e3cR-QVHIEbMDJWCSRDHXmlY/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: '243352759',
        text: '🚨 <b>NEW ALERT DETECTED BY AI</b>\n\n<b>Headline:</b> ' + inc.headline + '\n<b>Type:</b> ' + inc.type + '\n<b>Summary:</b> ' + inc.summary + '\n\n<b>Source:</b> <a href="' + inc.sourceUrl + '">' + inc.sourceName + '</a>',
        parse_mode: 'HTML'
      })
    });
    
    if (res.ok) {
      console.log('Telegram sent successfully');
    } else {
      console.error('Telegram failed', await res.text());
    }
  } else {
    console.log('Gemini decided the article was not relevant.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
