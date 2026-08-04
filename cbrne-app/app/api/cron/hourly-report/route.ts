import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { geminiGenerate, checkAllModels } from '@/lib/gemini-client';

export const maxDuration = 60; // 1 minute max duration

export async function generateHourlyReport() {
  // 1. Fetch the latest News Monitoring API check
  const lastRun = await prisma.systemLog.findFirst({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' }
  });

  let newsStatusMsg = '⚠️ <i>Background `fetch-news` cron job has not run yet.</i>';
  if (lastRun) {
    const outcome = lastRun.details || lastRun.status;
    newsStatusMsg = `✅ <b>Last Checked:</b> ${lastRun.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${outcome}`;
  }

  // 2. Check ALL Gemini models individually
  const modelStatuses = await checkAllModels();
  let geminiStatusSection = '';
  for (const ms of modelStatuses) {
    const name = ms.model.replace('gemini-', '');
    if (ms.status === 'online') {
      geminiStatusSection += `  ✅ ${name} (${ms.latencyMs}ms)\n`;
    } else if (ms.status === 'rate_limited') {
      geminiStatusSection += `  ⚠️ ${name} — Rate limited\n`;
    } else {
      geminiStatusSection += `  ❌ ${name} — ${ms.error || 'Unavailable'}\n`;
    }
  }

  // 3. Check NewsAPI Linkage + extract top headline and content
  let newsApiStatus = 'Unknown';
  let newsApiTopHeadline = '';
  let newsApiTopContent = '';
  try {
    const newsApiKey = process.env.NEWSAPI_KEY;
    if (newsApiKey) {
      const start = Date.now();
      const res = await fetch(`https://newsapi.org/v2/everything?q=singapore&sortBy=publishedAt&language=en&pageSize=1&apiKey=${newsApiKey}`);
      const latency = Date.now() - start;
      if (res.ok) {
        newsApiStatus = `✅ ONLINE (${latency}ms)`;
        const data = await res.json();
        if (data.articles?.length > 0) {
          const article = data.articles[0];
          newsApiTopHeadline = article.title || '';
          newsApiTopContent = [article.title, article.description, article.content].filter(Boolean).join('. ');
        }
      } else {
        newsApiStatus = `❌ ERROR (${res.status} ${res.statusText})`;
      }
    } else {
      newsApiStatus = `⚠️ MISSING API KEY`;
    }
  } catch (error: any) {
    newsApiStatus = `❌ FAILED (${error.message || 'Unknown'})`;
  }

  // 4. Check CNA RSS Linkage + extract top headline and description
  let cnaRssStatus = 'Unknown';
  let cnaTopContent = '';
  const cnaHeadlines = new Set<string>();
  const uniqueHeadlinesWithSource: { source: string, headline: string }[] = [];

  const cnaFeeds = [
    { name: 'Latest', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml' },
    { name: 'Singapore', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416' },
    { name: 'Today', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=679471' },
    { name: 'World', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311' },
    { name: 'Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511' }
  ];

  let cnaSuccessCount = 0;
  let totalCnaLatency = 0;

  for (const feed of cnaFeeds) {
    try {
      const start = Date.now();
      const res = await fetch(feed.url);
      const latency = Date.now() - start;
      if (res.ok) {
        cnaSuccessCount++;
        totalCnaLatency += latency;
        const xml = await res.text();
        const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          const title = titleMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
          if (!cnaHeadlines.has(title)) {
            cnaHeadlines.add(title);
            uniqueHeadlinesWithSource.push({ source: feed.name, headline: title });

            const descMatch = xml.match(/<item[^>]*>[\s\S]*?<description>([\s\S]*?)<\/description>/i);
            if (descMatch) {
              const descClean = descMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
              cnaTopContent += `[CNA ${feed.name}] ${title}. ${descClean}\n\n`;
            } else {
              cnaTopContent += `[CNA ${feed.name}] ${title}\n\n`;
            }
          }
        }
      }
    } catch (error: any) {
      // Ignore individual feed errors, we will report overall status
    }
  }

  if (cnaSuccessCount > 0) {
    cnaRssStatus = `✅ ONLINE (${Math.round(totalCnaLatency / cnaSuccessCount)}ms avg, ${cnaSuccessCount}/${cnaFeeds.length} feeds)`;
  } else {
    cnaRssStatus = `❌ FAILED (All feeds failed)`;
  }

  // 5. Check Supabase Linkage
  let supabaseStatus = 'Unknown';
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    supabaseStatus = `✅ ONLINE (${latency}ms)`;
  } catch (error: any) {
    supabaseStatus = `❌ FAILED (${error.message || 'Unknown'})`;
  }

  // 6. Check Overall Compute on Vercel
  const memoryUsage = process.memoryUsage();
  const memoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
  const vercelRegion = process.env.VERCEL_REGION || 'Local/Unknown';
  const computeStatus = `✅ Region: ${vercelRegion} | RAM: ${memoryMB}MB`;

  // 7. Check for relevant incidents in the past hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentThreats = await prisma.incident.findMany({
    where: {
      createdAt: { gte: oneHourAgo },
      isRelevant: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  let threatSection = '';
  if (recentThreats.length > 0) {
    threatSection = `\n<b>🚨 Threats Detected (Past 1hr):</b> ${recentThreats.length}\n`;
    for (const t of recentThreats.slice(0, 3)) {
      threatSection += `• <b>[${t.type}]</b> ${t.headline}\n`;
    }
    if (recentThreats.length > 3) {
      threatSection += `<i>...and ${recentThreats.length - 3} more</i>\n`;
    }
  } else {
    threatSection = `\n💚 <b>No CBRNE threats detected (Past 1hr)</b>\n`;
  }

  // Heartbeat: show top news from each source as proof of life
  threatSection += `\n<b>💓 Heartbeat — Top News Pulse:</b>\n`;
  if (newsApiTopHeadline) {
    threatSection += `📰 <b>NewsAPI:</b> ${newsApiTopHeadline}\n`;
  } else {
    threatSection += `📰 <b>NewsAPI:</b> <i>No headlines available</i>\n`;
  }
  if (uniqueHeadlinesWithSource.length > 0) {
    for (const item of uniqueHeadlinesWithSource) {
      threatSection += `📡 <b>CNA RSS (${item.source}):</b> ${item.headline}\n`;
    }
  } else {
    threatSection += `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
  }

  // Run extracted news through Gemini for CBRNE assessment (with model fallback)
  if (newsApiTopContent || cnaTopContent) {
    try {
      const newsContent = [
        newsApiTopContent ? `[NewsAPI Article]\n${newsApiTopContent}` : '',
        cnaTopContent ? `[CNA Articles]\n${cnaTopContent.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      const geminiAnalysis = await geminiGenerate({
        contents: `You are a CBRNE (Chemical, Biological, Radiological, Nuclear, Explosive) threat analyst monitoring Singapore.

Below are the top extracted news articles from live feeds. Analyze the full content and provide a detailed threat assessment and advisory:
1. Detailed Assessment: Is there any CBRNE relevance? (Yes/No + brief reasoning).
2. General Security Posture: Provide a thorough analysis of the general security posture for Singapore based on this news. If there is no threat or elevation of the current security posture, keep this extremely brief (e.g., "Normal" or "No change").
3. Advisory: Provide an actionable advisory based strictly on your assessment. If there is a potential threat, clearly outline steps for residents (Indoors/Outdoors/Medical). If there is no threat, state "None".

News Content:
${newsContent}

Reply concisely but comprehensively. When using common widely known acronyms, use ONLY the acronym and completely omit the full long words to shorten the output. You may use standard Telegram HTML tags like <b> for bolding. Do NOT use markdown (**).`,
      });
      const analysis = geminiAnalysis.text?.trim();
      if (analysis) {
        threatSection += `\n🤖 <b>Gemini Assessment (${geminiAnalysis.modelUsed}):</b>\n<i>${analysis}</i>\n`;
      }
    } catch {
      threatSection += `\n🤖 <b>Gemini Assessment:</b> <i>All models unavailable</i>\n`;
    }
  }

  // 8. Construct the Hourly Report Message
  const reportMsg = `📊 <b>SYSTEM HOURLY REPORT</b> 📊

<b>News Monitoring Cron Job</b>
${newsStatusMsg}
${threatSection}
<b>System Linkages & APIs</b>
<b>Gemini AI Engine:</b>
${geminiStatusSection}<b>NewsAPI Link:</b> ${newsApiStatus}
<b>CNA RSS Link:</b> ${cnaRssStatus}
<b>Supabase Link:</b> ${supabaseStatus}

<b>Vercel Compute</b>
${computeStatus}

<i>Report generated automatically.</i>`;

  // 6. Send to Telegram
  if (process.env.TELEGRAM_CHAT_ID) {
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, reportMsg);
  }
}

export async function GET(request: Request) {
  // 1. Verify Cron Secret
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret');

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && secretParam !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await generateHourlyReport();
    return NextResponse.json({ success: true, message: 'Hourly report sent' });
  } catch (error: any) {
    console.error('Failed to generate hourly report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
