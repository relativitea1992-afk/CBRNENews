import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { DateTime } from 'luxon';

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Check if it's a message with text
    if (body.message && body.message.text) {
      const text = body.message.text.toLowerCase();
      const chatId = body.message.chat.id.toString();

      // Basic security: Only respond to our designated CHAT_ID
      if (chatId !== process.env.TELEGRAM_CHAT_ID) {
         console.warn(`Unauthorized chat ID attempted to use bot: ${chatId}`);
         return NextResponse.json({ success: true }); // Return 200 so Telegram stops retrying
      }

      if (text.startsWith('/status')) {
        const oneDayAgo = DateTime.now().minus({ days: 1 }).toJSDate();
        const activeIncidents = await prisma.incident.findMany({
          where: {
            isRelevant: true,
            createdAt: { gte: oneDayAgo }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (activeIncidents.length === 0) {
          await sendTelegramMessage(chatId, "✅ <b>Status:</b> No active CBRNE/Odour threats detected in the last 24 hours.");
        } else {
          let msg = `⚠️ <b>Status:</b> ${activeIncidents.length} active threat(s) detected in the last 24 hours:\n\n`;
          activeIncidents.forEach((inc, idx) => {
            msg += `${idx + 1}. [${inc.type}] <a href="${inc.sourceUrl}">${inc.headline}</a>\n`;
          });
          await sendTelegramMessage(chatId, msg);
        }
      } else if (text.startsWith('/latest')) {
        const latestIncident = await prisma.incident.findFirst({
          where: { isRelevant: true },
          orderBy: { createdAt: 'desc' }
        });

        if (!latestIncident) {
          await sendTelegramMessage(chatId, "No relevant threats found in the database.");
        } else {
           const msg = `🔍 <b>LATEST THREAT</b>\n\n<b>Headline:</b> ${latestIncident.headline}\n<b>Type:</b> ${latestIncident.type}\n<b>Summary:</b> ${latestIncident.summary}\n\n<b>Link:</b> ${latestIncident.sourceUrl}`;
           await sendTelegramMessage(chatId, msg, { lat: latestIncident.lat, lon: latestIncident.lng, type: latestIncident.type });
        }
      } else if (text.startsWith('/test')) {
        const { generateHourlyReport } = await import('../cron/hourly-report/route');
        await generateHourlyReport();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error handling Telegram webhook:', error);
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}
