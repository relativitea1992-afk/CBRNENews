import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const maxDuration = 60; // 1 minute max duration

export async function GET(request: Request) {
  // 1. Verify Cron Secret
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2. Fetch the latest News Monitoring API check
    const lastRun = await prisma.systemLog.findFirst({
      where: { jobName: 'fetch-news' },
      orderBy: { createdAt: 'desc' }
    });

    let newsStatusMsg = '⚠️ No recent news monitoring data found.';
    if (lastRun) {
      newsStatusMsg = `✅ <b>Last Checked:</b> ${lastRun.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${lastRun.details || lastRun.status}`;
    }

    // 3. Perform High-Level System Check on Gemini API
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

    // 4. Construct the Hourly Report Message
    const reportMsg = `📊 <b>SYSTEM HOURLY REPORT</b> 📊

<b>News Monitoring API</b>
${newsStatusMsg}

<b>Gemini AI Triage Engine</b>
<b>Status:</b> ${geminiStatus}

<i>Report generated automatically.</i>`;

    // 5. Send to Telegram
    if (process.env.TELEGRAM_CHAT_ID) {
      // The third parameter in sendTelegramMessage is optional location options, omit for standard message
      await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, reportMsg);
    }

    return NextResponse.json({ success: true, message: 'Hourly report sent' });
  } catch (error: any) {
    console.error('Failed to generate hourly report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
