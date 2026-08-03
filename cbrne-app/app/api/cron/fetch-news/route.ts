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
    const cnaFeeds = [
      'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', // Latest news
      'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416', // Singapore
      'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=679471', // Today
      'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311', // World
      'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511' // Asia
    ];

    for (const feedUrl of cnaFeeds) {
      try {
        const feed = await parser.parseURL(feedUrl);
        // Take top 10 from each category to avoid overloading
        feed.items.slice(0, 10).forEach(item => {
          articlesToProcess.push({
            title: item.title || '',
            content: item.contentSnippet || item.content || '',
            url: item.link || '',
            source: 'CNA',
            publishedAt: new Date(item.pubDate || Date.now())
          });
        });
      } catch (e) {
        console.error('Error fetching CNA feed:', feedUrl, e);
      }
    }
  } catch (err) {
    console.error('Error fetching CNA RSS:', err);
  }

  let processedCount = 0;
  let threatCount = 0;
  const sourceCounts: Record<string, number> = {};
  const modelsUsed = new Set<string>();

  for (const article of articlesToProcess) {
    if (!article.url || !article.title) continue;

    // Check if already processed to save Gemini calls
    const existing = await prisma.incident.findUnique({ where: { sourceUrl: article.url } });
    if (existing) continue;

    const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
    processedCount++;
    sourceCounts[article.source] = (sourceCounts[article.source] || 0) + 1;
    if (triage && triage.modelUsed) {
      modelsUsed.add(triage.modelUsed);
    }

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
          modelUsed: triage.modelUsed || 'Unknown',
          isRelevant: true,
        }
      });

      // Send Telegram Alert
      const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨
      
<b>Headline:</b> ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Threat Assessment:</b>
${triage.summary}

${triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n\n` : ''}<b>Model Used:</b> ${triage.modelUsed || 'Unknown'}
<b>Link:</b> ${article.url}`;

      await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
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

  const sourceBreakdown = Object.entries(sourceCounts).map(([src, count]) => `${src}: ${count}`).join(', ');
  const breakdownStr = sourceBreakdown ? ` (${sourceBreakdown})` : '';
  const modelsStr = modelsUsed.size > 0 ? ` using [${Array.from(modelsUsed).join(', ')}]` : '';

  // Log the execution to SystemLog
  await prisma.systemLog.create({
    data: {
      jobName: 'fetch-news',
      status: 'SUCCESS',
      details: `Verified ${processedCount} new articles via Gemini${modelsStr}${breakdownStr}. ${threatCount === 0 ? 'No relevant threats detected.' : `Found ${threatCount} relevant threats.`}`
    }
  });

  return NextResponse.json({ success: true, processedCount, threatCount });
}
