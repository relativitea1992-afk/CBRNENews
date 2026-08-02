import { NextResponse } from 'next/server';
import Parser from 'rss-parser';
import prisma from '@/lib/prisma';
import { triageNewsArticle } from '@/lib/gemini';
import { sendTelegramMessage } from '@/lib/telegram';

const parser = new Parser();

export const maxDuration = 300; // Allow up to 5 minutes for AI processing

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const articlesToProcess: { title: string, content: string, url: string, source: string, publishedAt: Date }[] = [];

  // 1. Fetch from NewsAPI
  try {
    const newsApiKey = process.env.NEWSAPI_KEY;
    if (newsApiKey) {
      // Searching globally but emphasizing keywords
      const query = encodeURIComponent('("odour incident" OR "toxic smell" OR leak OR "potential release" OR CBRNE OR chemical OR biological OR radiological OR nuclear OR explosive) AND (Singapore OR Johor OR Batam OR Riau OR Pasir Gudang)');
      const res = await fetch(`https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&language=en&pageSize=10&apiKey=${newsApiKey}`);
      const data = await res.json();
      
      if (data.articles) {
        for (const article of data.articles) {
          articlesToProcess.push({
            title: article.title || '',
            content: (article.description || '') + ' ' + (article.content || ''),
            url: article.url,
            source: article.source?.name || 'NewsAPI',
            publishedAt: new Date(article.publishedAt || Date.now())
          });
        }
      }
    }
  } catch (err) {
    console.error('Error fetching NewsAPI:', err);
  }

  // 2. Fetch from CNA RSS
  try {
    // Note: CNA RSS URL might vary, using a standard one for Singapore news
    const feed = await parser.parseURL('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml');
    feed.items.slice(0, 10).forEach(item => {
      // CNA feed contains general news, we'll let Gemini filter it
      articlesToProcess.push({
        title: item.title || '',
        content: item.contentSnippet || item.content || '',
        url: item.link || '',
        source: 'CNA',
        publishedAt: new Date(item.pubDate || Date.now())
      });
    });
  } catch (err) {
    console.error('Error fetching CNA RSS:', err);
  }

  let processedCount = 0;
  let threatCount = 0;

  for (const article of articlesToProcess) {
    if (!article.url || !article.title) continue;

    // Check if already processed to save Gemini calls
    const existing = await prisma.incident.findUnique({ where: { sourceUrl: article.url } });
    if (existing) continue;

    const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
    processedCount++;

    if (triage && triage.isRelevant) {
      threatCount++;
      
      // Save to DB
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

      // Send Telegram Alert
      const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨
      
<b>Headline:</b> ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Impact Summary:</b>
${triage.summary}

${triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n` : ''}
<b>Link:</b> ${article.url}`;

      await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng });
    } else if (triage && !triage.isRelevant) {
       // Save as irrelevant to avoid reprocessing
       await prisma.incident.create({
        data: {
          headline: article.title.substring(0, 200),
          summary: "Irrelevant",
          sourceUrl: article.url,
          sourceName: article.source,
          publishedAt: article.publishedAt,
          isRelevant: false,
        }
      });
    }
  }

  return NextResponse.json({ success: true, processedCount, threatCount });
}
