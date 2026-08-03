import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const maxDuration = 60; // 1 minute max duration

export async function generateHourlyReport() {
  // 1. Fetch the latest News Monitoring API check
  const lastRun = await prisma.systemLog.findFirst({
    where: { jobName: 'fetch-news' },
    orderBy: { createdAt: 'desc' }
  });

  let newsStatusMsg = '⚠️ No recent news monitoring data found.';
  if (lastRun) {
    newsStatusMsg = `✅ <b>Last Checked:</b> ${lastRun.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${lastRun.details || lastRun.status}`;
  }

  // 2. Perform High-Level System Check on Gemini API
  let geminiStatus = 'Unknown';
  let geminiLatency = 0;
  try {
    const start = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Reply with "OK" if you are online.',
    });
    geminiLatency = Date.now() - start;
    
    if (response.text?.includes('OK')) {
      geminiStatus = `✅ ONLINE (Latency: ${geminiLatency}ms)`;
    } else {
      geminiStatus = `⚠️ ONLINE BUT UNEXPECTED RESPONSE (Latency: ${geminiLatency}ms)`;
    }
  } catch (error: any) {
    if (error.status === 429) {
        geminiStatus = `❌ RATE LIMITED (Quota Exceeded)`;
    } else {
        geminiStatus = `❌ ERROR (${error.message || 'Unknown'})`;
    }
  }

  // 3. Check NewsAPI Linkage + extract top headline
  let newsApiStatus = 'Unknown';
  let newsApiTopHeadline = '';
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
          newsApiTopHeadline = data.articles[0].title || '';
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

  // 4. Check CNA RSS Linkage + extract top headline
  let cnaRssStatus = 'Unknown';
  let cnaTopHeadline = '';
  try {
    const start = Date.now();
    const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml');
    const latency = Date.now() - start;
    if (res.ok) {
      cnaRssStatus = `✅ ONLINE (${latency}ms)`;
      const xml = await res.text();
      const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
      if (titleMatch) {
        cnaTopHeadline = titleMatch[1];
      } else {
        // Fallback: try without CDATA
        const simpleTitleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>(.*?)<\/title>/);
        if (simpleTitleMatch) {
          cnaTopHeadline = simpleTitleMatch[1];
        }
      }
    } else {
      cnaRssStatus = `❌ ERROR (${res.status} ${res.statusText})`;
    }
  } catch (error: any) {
    cnaRssStatus = `❌ FAILED (${error.message || 'Unknown'})`;
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
    // Heartbeat: no threats, show top news from each source as proof of life
    threatSection = `\n💚 <b>No CBRNE threats detected (Past 1hr)</b>\n\n<b>💓 Heartbeat — Top News Pulse:</b>\n`;
    if (newsApiTopHeadline) {
      threatSection += `📰 <b>NewsAPI:</b> ${newsApiTopHeadline}\n`;
    } else {
      threatSection += `📰 <b>NewsAPI:</b> <i>No headlines available</i>\n`;
    }
    if (cnaTopHeadline) {
      threatSection += `📡 <b>CNA RSS:</b> ${cnaTopHeadline}\n`;
    } else {
      threatSection += `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
    }
  }

  // 8. Construct the Hourly Report Message
  const reportMsg = `📊 <b>SYSTEM HOURLY REPORT</b> 📊

<b>News Monitoring Cron Job</b>
${newsStatusMsg}
${threatSection}
<b>System Linkages & APIs</b>
<b>Gemini AI Engine:</b> ${geminiStatus}
<b>NewsAPI Link:</b> ${newsApiStatus}
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
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
