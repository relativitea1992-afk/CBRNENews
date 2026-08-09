import { NextResponse } from 'next/server';
import { after } from 'next/server';
import Parser from 'rss-parser';
import prisma from '@/lib/prisma';
import { triageNewsArticle, clusterIncident } from '@/lib/gemini';
import { sendTelegramMessage } from '@/lib/telegram';

const parser = new Parser();

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linkifyCoordinates(text: string) {
  // Matches [Station Name](MAP:Lat,Lng) and converts to <a href="...">Station Name</a>
  let linked = text.replace(/\[([^\]]+)\]\(MAP:\s*([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*)\)/gi, '<a href="https://www.google.com/maps/search/?api=1&query=$2,$3">$1</a>');
  // Fallback to strip out raw Lat/Lng if the model forgets the format
  linked = linked.replace(/\(Lat:\s*[+-]?\d+\.?\d*,\s*Lng:\s*[+-]?\d+\.?\d*\)/gi, '');
  return linked;
}

export const maxDuration = 300; // Allow up to 5 minutes for AI processing

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret');
  
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && secretParam !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const articlesToProcess: { title: string, content: string, url: string, source: string, publishedAt: Date }[] = [];

  let ingressBytes = 0;
  let egressBytes = 0;

  // 1. Fetch from NewsAPI
  try {
    const newsApiKey = process.env.NEWSAPI_KEY;
    if (newsApiKey) {
      // Searching globally without location constraints to get more articles
      const query = encodeURIComponent('("odour incident" OR "toxic smell" OR leak OR "potential release" OR CBRNE OR chemical OR biological OR radiological OR nuclear OR explosive OR haze OR "air quality")');
      const res = await fetch(`https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&language=en&pageSize=10&apiKey=${newsApiKey}`);
      const text = await res.text();
      ingressBytes += Buffer.byteLength(text, 'utf8');
      const data = JSON.parse(text);
      
      if (data.articles) {
        for (const article of data.articles) {
          articlesToProcess.push({
            title: article.title || '',
            content: (article.description || '') + ' ' + (article.content || ''),
            url: article.url,
            source: 'NewsAPI',
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
        const res = await fetch(feedUrl);
        const xml = await res.text();
        ingressBytes += Buffer.byteLength(xml, 'utf8');
        const feed = await parser.parseString(xml);
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
      } catch (e: any) {
        console.error('Error fetching CNA feed:', feedUrl, e);
        await prisma.systemLog.create({ data: { jobName: 'fetch-news-error', status: 'ERROR', details: `CNA Feed Error (${feedUrl}): ${e.message}` }});
      }
    }
  } catch (err: any) {
    console.error('Error fetching CNA RSS:', err);
    await prisma.systemLog.create({ data: { jobName: 'fetch-news-error', status: 'ERROR', details: `CNA Master Error: ${err.message}` }});
  }

  // 3. Fetch from Straits Times RSS
  try {
    const stFeeds = [
      'https://www.straitstimes.com/news/singapore/rss.xml',
      'https://www.straitstimes.com/news/world/rss.xml',
      'https://www.straitstimes.com/news/asia/rss.xml'
    ];

    for (const feedUrl of stFeeds) {
      try {
        const res = await fetch(feedUrl);
        const xml = await res.text();
        ingressBytes += Buffer.byteLength(xml, 'utf8');
        const feed = await parser.parseString(xml);
        // Take top 10 from each category to avoid overloading
        feed.items.slice(0, 10).forEach(item => {
          articlesToProcess.push({
            title: item.title || '',
            content: item.contentSnippet || item.content || '',
            url: item.link || '',
            source: 'ST RSS',
            publishedAt: new Date(item.pubDate || Date.now())
          });
        });
      } catch (e: any) {
        console.error('Error fetching ST feed:', feedUrl, e);
        await prisma.systemLog.create({ data: { jobName: 'fetch-news-error', status: 'ERROR', details: `ST Feed Error (${feedUrl}): ${e.message}` }});
      }
    }
  } catch (err: any) {
    console.error('Error fetching ST RSS:', err);
    await prisma.systemLog.create({ data: { jobName: 'fetch-news-error', status: 'ERROR', details: `ST Master Error: ${err.message}` }});
  }

  let processedCount = 0;
  let threatCount = 0;
  const sourceCounts: Record<string, number> = {};
  const modelsUsed = new Set<string>();

  after(async () => {
    try {
      let totalPromptTokens = 0;
      let totalCandidatesTokens = 0;
      let totalWordCount = 0;

    for (const article of articlesToProcess) {
      if (!article.url || !article.title) continue;

      // Check if already processed to save Gemini calls
      const existing = await prisma.incident.findUnique({ where: { sourceUrl: article.url } });
      if (existing) continue;

      const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
      
      const wordsInArticle = (article.title?.split(/\s+/).length || 0) + (article.content?.split(/\s+/).length || 0);
      totalWordCount += wordsInArticle;

      processedCount++;
      sourceCounts[article.source] = (sourceCounts[article.source] || 0) + 1;
      if (triage && triage.modelUsed) {
        modelsUsed.add(triage.modelUsed);
      }
      if (triage && triage.usageMetadata) {
        totalPromptTokens += triage.usageMetadata.promptTokenCount || 0;
        totalCandidatesTokens += triage.usageMetadata.candidatesTokenCount || 0;
      }

      let clusterId: string | undefined = undefined;

      if (triage && triage.isRelevant) {
        // Find recent active threats to cluster with
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const recentActiveThreats = await prisma.incident.findMany({
          where: { isRelevant: true, createdAt: { gte: fortyEightHoursAgo } },
          orderBy: { createdAt: 'desc' }
        });

        if (recentActiveThreats.length > 0) {
           const clusterResult = await clusterIncident(
             triage.headline || article.title,
             triage.summary || '',
             triage.type || 'Unknown',
             recentActiveThreats.map(t => ({ id: t.id, clusterId: t.clusterId, headline: t.headline, summary: t.summary, type: t.type }))
           );
           if (clusterResult) {
             if (clusterResult.clusterId) clusterId = clusterResult.clusterId;
             if (clusterResult.usageMetadata) {
               totalPromptTokens += clusterResult.usageMetadata.promptTokenCount || 0;
               totalCandidatesTokens += clusterResult.usageMetadata.candidatesTokenCount || 0;
             }
           }
        }
      }

      if (triage) {
        // Save to DB (both threats and non-threats) to prevent reprocessing them next hour
        const savedIncident = await prisma.incident.create({
          data: {
            headline: triage.headline || article.title,
            summary: triage.summary || 'No relevant threats detected.',
            sourceUrl: article.url,
            sourceName: article.source,
            publishedAt: article.publishedAt,
            lat: triage.lat,
            lng: triage.lng,
            type: triage.type || 'Unknown',
            advisory: triage.advisory,
            modelUsed: triage.modelUsed || 'Unknown',
            isRelevant: triage.isRelevant || false,
            clusterId: clusterId
          }
        });
        
        if (triage.isRelevant && !clusterId) {
          // If no existing cluster matched, this incident becomes its own new cluster
          await prisma.incident.update({
             where: { id: savedIncident.id },
             data: { clusterId: savedIncident.id }
          });
        }
      }

      if (triage && triage.isRelevant) {
        threatCount++;
        
        const tokenConsumptionStr = triage.usageMetadata 
          ? `\n<b>Tokens Consumed:</b> ${triage.usageMetadata.totalTokenCount} [In: ${triage.usageMetadata.promptTokenCount}, Out: ${triage.usageMetadata.candidatesTokenCount}]`
          : '';

        // Send Telegram Alert
        const googleMapsLink = triage.lat && triage.lng ? `\n<b>Location:</b> <a href="https://www.google.com/maps/search/?api=1&query=${triage.lat},${triage.lng}">View on Google Maps</a>` : '';

        const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨
        
<b>Headline:</b> ${escapeHtml(triage.headline)}
<b>Type:</b> ${escapeHtml(triage.type)}
<b>Source:</b> ${escapeHtml(article.source)}${googleMapsLink}

<b>Threat Assessment:</b>
${linkifyCoordinates(escapeHtml(triage.summary))}

${triage.advisory ? `<b>Advisory:</b>\n${linkifyCoordinates(escapeHtml(triage.advisory))}\n\n` : ''}<b>Model Used:</b> ${escapeHtml(triage.modelUsed || 'Unknown')}${tokenConsumptionStr}
<b>Link:</b> ${escapeHtml(article.url)}`;
        let telegramPayloadSize = 0;
        try {
          const payloadStr = JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID!, text: alertMsg });
          telegramPayloadSize = Buffer.byteLength(payloadStr, 'utf8');
        } catch(e) {}
        
        await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng, type: triage.type });
        egressBytes += telegramPayloadSize;
      }
    }

    const sourceBreakdown = Object.entries(sourceCounts).map(([src, count]) => `${src}: ${count}`).join(', ');
    const breakdownStr = sourceBreakdown ? `${sourceBreakdown}` : 'No new articles';
    
    let providerName = 'AI';
    const modelArray = Array.from(modelsUsed);
    if (modelArray.some(m => m.includes('gemini'))) providerName = 'Gemini';
    if (modelArray.some(m => m.includes('gemma'))) providerName = 'Gemma';
    if (modelArray.some(m => m.includes('gemini')) && modelArray.some(m => m.includes('gemma'))) providerName = 'Gemini & Gemma';
    
    const modelsStr = modelsUsed.size > 0 ? ` via ${providerName} [${modelArray.join(', ')}]` : '';
    const tokenStr = (totalPromptTokens > 0 || totalCandidatesTokens > 0) 
      ? ` | Tokens Consumed: ${totalPromptTokens + totalCandidatesTokens} [In: ${totalPromptTokens}, Out: ${totalCandidatesTokens}] | Models: ${modelArray.join(', ')}` 
      : '';
    const bandwidthStr = ` | Ingress: ${ingressBytes} bytes | Egress: ${egressBytes} bytes`;

      // Log the execution to SystemLog
      await prisma.systemLog.create({
        data: {
          jobName: 'fetch-news',
          status: 'SUCCESS',
          details: `Verified: Total ${processedCount} new articles (${breakdownStr})${modelsStr}${tokenStr}${bandwidthStr} | Words: ${totalWordCount}. ${threatCount === 0 ? 'No relevant threats detected.' : `Found ${threatCount} relevant threats.`}`
        }
      });
    } catch (error: any) {
      console.error('Background fetch-news error:', error);
      await prisma.systemLog.create({
        data: {
          jobName: 'fetch-news',
          status: 'ERROR',
          details: `Background processing failed: ${error.message || String(error)}`
        }
      });
    }
  });

  return NextResponse.json({ success: true, message: 'Processing in background' });
}
