import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { geminiGenerate, checkAllModels } from '@/lib/gemini-client';

export const maxDuration = 60; // 1 minute max duration
export const preferredRegion = 'sin1';

export async function generateHourlyReport() {
  // 1. Fetch the News Monitoring API checks from the past 1 hour (up to 2 runs)
  const oneHourAgoLog = new Date(Date.now() - 60 * 60 * 1000);
  const recentRuns = await prisma.systemLog.findMany({
    where: { 
      jobName: 'fetch-news',
      createdAt: { gte: oneHourAgoLog }
    },
    orderBy: { createdAt: 'desc' },
    take: 2
  });

  let newsStatusMsg = '⚠️ <i>Background `fetch-news` cron job has not run in the past hour.</i>';
  
  const escapeHtml = (unsafe: string) => {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
  };

  if (recentRuns.length > 0) {
    let checkedLines = '';
    for (let i = 0; i < recentRuns.length; i++) {
      const run = recentRuns[i];
      let outcome = run.details || run.status;
      // Escape raw text first
      outcome = escapeHtml(outcome);
      outcome = outcome.replace(/ via /g, '\nProcessed via ')
                       .replace(/ \| Tokens Consumed:/g, '\nTokens Consumed:')
                       .replace(/\. Found/g, '.\nFound')
                       .replace(/\. No relevant threats/g, '.\nNo relevant threats')
                       .replace(/\. Threats detected!/g, '.\nThreats detected!');
      const icon = run.status === 'SUCCESS' ? '✅' : '❌';
      checkedLines += `${icon} <b>News Fetched:</b> ${run.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${outcome}\n\n`;
    }
    newsStatusMsg = checkedLines.trim();
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

  await Promise.all(cnaFeeds.map(async (feed) => {
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
  }));

  if (cnaSuccessCount > 0) {
    cnaRssStatus = `✅ ONLINE (${Math.round(totalCnaLatency / cnaSuccessCount)}ms avg, ${cnaSuccessCount}/${cnaFeeds.length} feeds)`;
  } else {
    cnaRssStatus = `❌ FAILED (All feeds failed)`;
  }

  // 4b. Check Straits Times RSS Linkage + extract top headline and description
  let stRssStatus = 'Unknown';
  let stTopContent = '';
  const stHeadlines = new Set<string>();
  const uniqueStHeadlinesWithSource: { source: string, headline: string }[] = [];

  const stFeeds = [
    { name: 'Singapore', url: 'https://www.straitstimes.com/news/singapore/rss.xml' },
    { name: 'World', url: 'https://www.straitstimes.com/news/world/rss.xml' },
    { name: 'Asia', url: 'https://www.straitstimes.com/news/asia/rss.xml' }
  ];

  let stSuccessCount = 0;
  let totalStLatency = 0;

  await Promise.all(stFeeds.map(async (feed) => {
    try {
      const start = Date.now();
      const res = await fetch(feed.url);
      const latency = Date.now() - start;
      if (res.ok) {
        stSuccessCount++;
        totalStLatency += latency;
        const xml = await res.text();
        const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          const title = titleMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
          if (!stHeadlines.has(title)) {
            stHeadlines.add(title);
            uniqueStHeadlinesWithSource.push({ source: feed.name, headline: title });

            const descMatch = xml.match(/<item[^>]*>[\s\S]*?<description>([\s\S]*?)<\/description>/i);
            if (descMatch) {
              const descClean = descMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
              stTopContent += `[ST ${feed.name}] ${title}. ${descClean}\n\n`;
            } else {
              stTopContent += `[ST ${feed.name}] ${title}\n\n`;
            }
          }
        }
      }
    } catch (error: any) {
      // Ignore individual feed errors, we will report overall status
    }
  }));

  if (stSuccessCount > 0) {
    stRssStatus = `✅ ONLINE (${Math.round(totalStLatency / stSuccessCount)}ms avg, ${stSuccessCount}/${stFeeds.length} feeds)`;
  } else {
    stRssStatus = `❌ FAILED (All feeds failed)`;
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

  // 7. Check for relevant incidents in the past 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentThreats = await prisma.incident.findMany({
    where: {
      createdAt: { gte: twentyFourHoursAgo },
      isRelevant: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  let threatSection = '';
  if (recentThreats.length > 0) {
    threatSection = `\n<b>🚨 Threats Detected (Past 24hr):</b> ${recentThreats.length}\n`;
    for (const t of recentThreats.slice(0, 3)) {
      threatSection += `• <b>[${t.type}]</b> ${t.headline}\n`;
    }
    if (recentThreats.length > 3) {
      threatSection += `<i>...and ${recentThreats.length - 3} more</i>\n`;
    }
  } else {
    threatSection = `\n💚 <b>No CBRNE threats detected (Past 24hr)</b>\n`;
  }

  // Run extracted news through Gemini for CBRNE assessment & top headline selection
  let heartbeatSection = `\n<b>💓 Heartbeat — Top News Pulse:</b>\n`;
  if (newsApiTopHeadline) {
    heartbeatSection += `📰 <b>NewsAPI:</b> ${newsApiTopHeadline}\n`;
  } else {
    heartbeatSection += `📰 <b>NewsAPI:</b> <i>No headlines available</i>\n`;
  }

  let cnaPulse = '';
  let stPulse = '';
  let geminiAssessmentHtml = '';

  if (newsApiTopContent || cnaTopContent || stTopContent) {
    try {
      const newsContent = [
        newsApiTopContent ? `[NewsAPI Article]\n${newsApiTopContent}` : '',
        cnaTopContent ? `[CNA Articles]\n${cnaTopContent.trim()}` : '',
        stTopContent ? `[Straits Times Articles]\n${stTopContent.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      
      // Parallelize the Gemini operations to stay within Vercel timeout constraints while keeping them separate
      const [geminiSelection, geminiAssessmentResponse] = await Promise.all([
        geminiGenerate({
          contents: `You are a CBRNE threat analyst monitoring Singapore.
Below are the top extracted news articles from live feeds.
Task: Review the [CNA Articles] and [Straits Times Articles]. Select the 2 most CBRNE-relevant headlines for CNA and the 2 most relevant for Straits Times. If there's no obvious CBRNE relevance, just select the top 2 major news.

Output ONLY a valid raw JSON object (without markdown blocks) in the following structure:
{
  "cnaTop2": [{"source": "Source Category", "headline": "Headline string"}],
  "stTop2": [{"source": "Source Category", "headline": "Headline string"}]
}

News Content:
${newsContent}`,
          config: { responseMimeType: "application/json" }
        }),
        geminiGenerate({
          contents: `You are a CBRNE threat analyst monitoring Singapore.
Below are the top extracted news articles from live feeds.
Task 1: Provide a detailed threat assessment based on all articles (Yes/No CBRNE relevance + brief reasoning).
Task 2: Provide a general security posture analysis for Singapore. Keep it extremely brief (e.g., "Normal") if no threat.
Task 3: Provide an actionable advisory based strictly on the assessment (or "None").

Output ONLY a valid raw JSON object (without markdown blocks) in the following structure:
{
  "assessment": "Detailed assessment html...",
  "generalPosture": "Security posture html...",
  "advisory": "Advisory html..."
}

Note: In the HTML fields, you may use standard Telegram HTML tags like <b> for bolding. Do NOT use markdown (**). When using common widely known acronyms, use ONLY the acronym.

News Content:
${newsContent}`,
          config: { responseMimeType: "application/json" }
        })
      ]);

      const selectionRaw = geminiSelection.text?.trim() || '{}';
      const selectionMatch = selectionRaw.match(/\{[\s\S]*\}/);
      const cleanSelectionJson = selectionMatch ? selectionMatch[0] : '{}';
      const selectionResult = JSON.parse(cleanSelectionJson);

      const assessmentRaw = geminiAssessmentResponse.text?.trim() || '{}';
      const assessmentMatch = assessmentRaw.match(/\{[\s\S]*\}/);
      const cleanAssessmentJson = assessmentMatch ? assessmentMatch[0] : '{}';
      const assessmentResult = JSON.parse(cleanAssessmentJson);

      if (selectionResult.cnaTop2 && selectionResult.cnaTop2.length > 0) {
        selectionResult.cnaTop2.forEach((item: any) => {
          cnaPulse += `📡 <b>CNA RSS (${item.source}):</b> ${item.headline}\n`;
        });
      }
      if (selectionResult.stTop2 && selectionResult.stTop2.length > 0) {
        selectionResult.stTop2.forEach((item: any) => {
          stPulse += `🗞️ <b>ST RSS (${item.source}):</b> ${item.headline}\n`;
        });
      }

      const sanitizeTgHtml = (str: string) => {
        if (!str) return '';
        return String(str)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<p>/gi, '')
          .replace(/<([^>]+)>/g, (match, tag) => {
             // allow only supported tags in Telegram HTML
             const lower = tag.toLowerCase().split(' ')[0];
             if (['b', '/b', 'i', '/i', 'u', '/u', 's', '/s', 'a', '/a', 'code', '/code', 'pre', '/pre'].includes(lower)) {
               return match;
             }
             return ''; // strip all other tags
          });
      };

      geminiAssessmentHtml = `
1. <b>Detailed Assessment:</b> ${sanitizeTgHtml(assessmentResult.assessment)}
2. <b>General Security Posture:</b> ${sanitizeTgHtml(assessmentResult.generalPosture)}
3. <b>Advisory:</b> ${sanitizeTgHtml(assessmentResult.advisory)}`;

      const selectionTokenStr = geminiSelection.usageMetadata?.totalTokenCount 
        ? ` (${geminiSelection.modelUsed}, Tokens: ${geminiSelection.usageMetadata.totalTokenCount} [In: ${geminiSelection.usageMetadata.promptTokenCount}, Out: ${geminiSelection.usageMetadata.candidatesTokenCount}])`
        : ` (${geminiSelection.modelUsed})`;

      const assessmentTokenStr = geminiAssessmentResponse.usageMetadata?.totalTokenCount 
        ? ` (${geminiAssessmentResponse.modelUsed}, Tokens: ${geminiAssessmentResponse.usageMetadata.totalTokenCount} [In: ${geminiAssessmentResponse.usageMetadata.promptTokenCount}, Out: ${geminiAssessmentResponse.usageMetadata.candidatesTokenCount}])`
        : ` (${geminiAssessmentResponse.modelUsed})`;

      threatSection += heartbeatSection.replace('Top News Pulse:', `Top News Pulse${selectionTokenStr}:`);
      threatSection += cnaPulse || `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
      threatSection += stPulse || `🗞️ <b>ST RSS:</b> <i>No headlines available</i>\n`;
      threatSection += `\n🤖 <b>Gemini Assessment${assessmentTokenStr}:</b>\n<i>${geminiAssessmentHtml.trim()}</i>\n`;
      
    } catch (e: any) {
      console.error('Gemini parsing error:', e);
      // Fallback if parsing fails or all models unavailable
      threatSection += heartbeatSection;
      threatSection += `📡 <b>CNA RSS:</b> <i>Error parsing top headlines</i>\n`;
      threatSection += `🗞️ <b>ST RSS:</b> <i>Error parsing top headlines</i>\n`;
      threatSection += `\n🤖 <b>Gemini Assessment:</b> <i>Unavailable or Error (${e.message})</i>\n`;
    }
  } else {
    // No content at all
    threatSection += heartbeatSection;
    threatSection += `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
    threatSection += `🗞️ <b>ST RSS:</b> <i>No headlines available</i>\n`;
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
<b>ST RSS Link:</b> ${stRssStatus}
<b>Supabase Link:</b> ${supabaseStatus}

<b>Vercel Compute</b>
${computeStatus}

<i>Report generated automatically.</i>`;

  // 6. Send to Telegram
  console.log("=== REPORT MSG ===");
  console.log(reportMsg);
  console.log("==================");
  if (process.env.TELEGRAM_CHAT_ID) {
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, reportMsg);
  }
}

import { after } from 'next/server';

export async function GET(request: Request) {
  // 1. Verify Cron Secret
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret');

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && secretParam !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Return immediately to prevent cron-job.org from timing out at 30 seconds,
    // and run the heavy report generation safely in the background on Vercel
    after(async () => {
      try {
        await generateHourlyReport();
        await prisma.systemLog.create({
          data: {
            jobName: 'hourly-report',
            status: 'SUCCESS',
            details: 'Hourly report successfully generated and sent to Telegram.'
          }
        });
      } catch (e: any) {
        console.error('Background hourly report failed:', e);
        try {
          await prisma.systemLog.create({
            data: {
              jobName: 'hourly-report',
              status: 'ERROR',
              details: e.message || 'Unknown error'
            }
          });
        } catch (logErr) {
          console.error('Failed to write hourly report error to log:', logErr);
        }
      }
    });
    
    return NextResponse.json({ success: true, message: 'Hourly report processing in background' });
  } catch (error: any) {
    console.error('Failed to init hourly report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
