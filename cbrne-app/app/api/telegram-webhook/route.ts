import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { DateTime } from 'luxon';

export const preferredRegion = 'sin1';

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const forwardedFor = request.headers.get('x-forwarded-for');
    const telegramIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (request.headers.get('x-real-ip') || 'Unknown');
    
    // Check if it's a message with text
    if (body.message && body.message.text) {
      const text = body.message.text.toLowerCase();
      const chatId = body.message.chat.id.toString();
      const requesterName = body.message?.from?.username 
        ? `@${body.message.from.username}` 
        : (body.message?.from?.first_name || 'User');

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
           let msg = `🔍 <b>LATEST THREAT</b>\n\n<b>Headline:</b> ${latestIncident.headline}\n<b>Type:</b> ${latestIncident.type}\n<b>Summary:</b> ${latestIncident.summary}`;
           
           if (latestIncident.advisory) {
             msg += `\n\n<b>Advisory:</b>\n${latestIncident.advisory}`;
           }
           
           msg += `\n\n<b>Model Used:</b> ${latestIncident.modelUsed || 'Unknown'}`;
           msg += `\n<b>Link:</b> ${latestIncident.sourceUrl}`;
           await sendTelegramMessage(chatId, msg, { lat: latestIncident.lat, lon: latestIncident.lng, type: latestIncident.type as any });
        }
      } else if (text.startsWith('/test')) {
        await sendTelegramMessage(chatId, "⏳ <b>Generating test report...</b> This may take a few seconds.");
        try {
          const { generateHourlyReport } = await import('../cron/hourly-report/route');
          await generateHourlyReport();
        } catch (e: any) {
          console.error('Error generating test hourly report:', e);
          await sendTelegramMessage(chatId, `❌ <b>Failed to generate test report:</b> ${e.message}`);
        }
      } else if (text.startsWith('/clear')) {
        const deleted = await prisma.incident.deleteMany({
          where: { isRelevant: true }
        });
        await sendTelegramMessage(chatId, `🧹 <b>Alerts Cleared:</b> ${deleted.count} active threat(s) have been removed from the dashboard.`);
      } else if (text.startsWith('/snapshot')) {
        const dashboardBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hazmat-scan.vercel.app';
        const dashboardUrl = `${dashboardBaseUrl}?snapshot=true`;
        const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(dashboardUrl)}&screenshot=true&meta=false&embed=screenshot.url&waitFor=%23map-ready&adblock=false&force=true`;
        
        await sendTelegramMessage(chatId, "📸 <b>Taking snapshot of the live dashboard...</b>");
        
        try {
          const imageReq = await fetch(microlinkUrl);
          if (imageReq.ok) {
            const arrayBuffer = await imageReq.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: 'image/png' });
            
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('photo', blob, 'dashboard.png');
            formData.append('caption', `Live Dashboard Snapshot: ${dashboardUrl}`);
            
            const token = process.env.TELEGRAM_BOT_TOKEN;
            const photoResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: 'POST',
              body: formData,
            });
            if (!photoResponse.ok) {
              console.error('Failed to send snapshot photo:', await photoResponse.text());
              await sendTelegramMessage(chatId, "❌ Failed to send dashboard snapshot photo.");
            }
          } else {
            console.error('Failed to fetch snapshot from Microlink:', await imageReq.text());
            await sendTelegramMessage(chatId, "❌ Failed to generate dashboard snapshot.");
          }
        } catch (e) {
          console.error('Error generating snapshot:', e);
          await sendTelegramMessage(chatId, "❌ Error generating dashboard snapshot.");
        }
      } else if (text.startsWith('/pingtest')) {
        await sendTelegramMessage(chatId, "⏳ <b>Running System Diagnostics...</b>\nFetching IPs and calculating latency. This will take a few seconds.");
        
        const { after } = await import('next/server');
        after(async () => {
          try {
            const dns = await import('dns/promises');
            const locationCache = new Map<string, string>();
            
            const getLocation = async (urlStr: string) => {
              if (!urlStr) return 'Unknown';
              try {
                let host = urlStr;
                if (urlStr.includes('://')) {
                  host = new URL(urlStr).hostname;
                }
                
                if (locationCache.has(host)) return locationCache.get(host)!;
                
                let address = '';
                try {
                  const dnsRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { 'Accept': 'application/dns-json' } });
                  const dnsData = await dnsRes.json();
                  const aRecord = dnsData.Answer?.find((a: any) => a.type === 1);
                  if (aRecord) address = aRecord.data;
                } catch(e) {}
                
                if (!address) {
                  // Fallback to native dns.lookup if Cloudflare fails
                  try {
                    const { address: nativeAddr } = await dns.lookup(host);
                    address = nativeAddr;
                  } catch (e) {}
                }

                if (!address) return 'Unknown IP';
                
                const geoRes = await fetch(`http://ip-api.com/json/${address}`);
                if (geoRes.ok) {
                  const geo = await geoRes.json();
                  const locParts = [];
                  if (geo.city) locParts.push(geo.city);
                  if (geo.regionName && geo.regionName !== geo.city) locParts.push(geo.regionName);
                  if (geo.country) locParts.push(geo.country);
                  const locStr = locParts.length > 0 ? locParts.join(', ') : 'Unknown Location';
                  
                  let provider = geo.org || geo.isp || '';
                  let finalLocStr = `${locStr} (${address})`;
                  if (provider) {
                    finalLocStr += ` [${provider}]`;
                  }
                  
                  const loc = geo.status === 'success' ? finalLocStr : `IP: ${address}`;
                  locationCache.set(host, loc);
                  return loc;
                }
                return `IP: ${address}`;
              } catch (e) {
                return 'Unknown';
              }
            };

            const ping = async (group: string, name: string, urlStr: string, testFn: () => Promise<string | void>) => {
              const start = Date.now();
              let status = '🔴 ERR';
              let latency = 0;
              let dynamicLoc: string | void = undefined;
              try {
                dynamicLoc = await testFn();
                latency = Date.now() - start;
                status = '🟢 OK';
              } catch (e) {
                latency = Date.now() - start;
              }
              const loc = dynamicLoc ? dynamicLoc : await getLocation(urlStr);
              return { group, name, status, latency, loc };
            };

            const promises = [
              ping('Vercel Compute', 'Self Ping', process.env.NEXT_PUBLIC_APP_URL || 'https://hazmat-scan.vercel.app', async () => {
                const url = process.env.NEXT_PUBLIC_APP_URL || 'https://hazmat-scan.vercel.app';
                let region = process.env.VERCEL_REGION || 'iad1';
                try {
                  const res = await fetch(url, { method: 'HEAD' });
                  const vercelId = res.headers.get('x-vercel-id');
                  if (vercelId) region = vercelId.split('::')[0];
                } catch(e) {}
                
                const locStr = await getLocation(url);
                return `${locStr} (Vercel Edge ${region})`;
              }),
              ping('Database', 'Supabase PostgreSQL', process.env.DATABASE_URL || '', async () => {
                await prisma.$queryRawUnsafe(`SELECT 1`);
                const urlStr = process.env.DATABASE_URL || '';
                const locStr = await getLocation(urlStr);
                return `${locStr} (Supabase)`;
              }),
              ping('Gemini APIs', 'Gemini (3.6-flash)', 'https://generativelanguage.googleapis.com', async () => {
                const key = process.env.GEMINI_API_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash?key=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gemini APIs', 'Gemini (3.5-flash)', 'https://generativelanguage.googleapis.com', async () => {
                const key = process.env.GEMINI_API_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash?key=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gemini APIs', 'Gemini (3.5-flash-lite)', 'https://generativelanguage.googleapis.com', async () => {
                const key = process.env.GEMINI_API_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite?key=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gemini APIs', 'Gemini (3.1-flash-lite)', 'https://generativelanguage.googleapis.com', async () => {
                const key = process.env.GEMINI_API_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite?key=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gemini APIs', 'Gemma (4-31b)', 'https://generativelanguage.googleapis.com', async () => {
                const key = process.env.GEMINI_API_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it?key=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('News API', 'NewsAPI.org', 'https://newsapi.org', async () => {
                const key = process.env.NEWSAPI_KEY;
                if (!key) throw new Error('No Key');
                const res = await fetch(`https://newsapi.org/v2/everything?q=test&pageSize=1&apiKey=${key}`);
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('CNA RSS', 'Latest', 'https://www.channelnewsasia.com', async () => {
                const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('CNA RSS', 'Singapore', 'https://www.channelnewsasia.com', async () => {
                const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('CNA RSS', 'Today', 'https://www.channelnewsasia.com', async () => {
                const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=679471', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('CNA RSS', 'World', 'https://www.channelnewsasia.com', async () => {
                const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('CNA RSS', 'Asia', 'https://www.channelnewsasia.com', async () => {
                const res = await fetch('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Straits Times RSS', 'Singapore', 'https://www.straitstimes.com', async () => {
                const res = await fetch('https://www.straitstimes.com/news/singapore/rss.xml', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Straits Times RSS', 'World', 'https://www.straitstimes.com', async () => {
                const res = await fetch('https://www.straitstimes.com/news/world/rss.xml', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Straits Times RSS', 'Asia', 'https://www.straitstimes.com', async () => {
                const res = await fetch('https://www.straitstimes.com/news/asia/rss.xml', { method: 'HEAD' });
                if (!res.ok) throw new Error('Bad status');
              })
            ];

            const completed = await Promise.all(promises);
            
            const grouped = completed.reduce((acc, curr) => {
              if (!acc[curr.group]) acc[curr.group] = { loc: curr.loc, items: [] };
              acc[curr.group].items.push(curr);
              return acc;
            }, {} as Record<string, { loc: string, items: typeof completed }>);
            
            const sourceRegion = process.env.VERCEL_REGION ? `Vercel (${process.env.VERCEL_REGION})` : 'Vercel';
            
            let telegramLocation = 'Unknown Location';
            try {
              if (telegramIp !== 'Unknown') {
                const geoRes = await fetch(`http://ip-api.com/json/${telegramIp}`);
                if (geoRes.ok) {
                  const geo = await geoRes.json();
                  if (geo.status === 'success') {
                    const locParts = [];
                    if (geo.city) locParts.push(geo.city);
                    if (geo.regionName && geo.regionName !== geo.city) locParts.push(geo.regionName);
                    if (geo.country) locParts.push(geo.country);
                    const locStr = locParts.length > 0 ? locParts.join(', ') : 'Unknown Location';
                    
                    let provider = geo.org || geo.isp || '';
                    if (provider.includes('Telegram')) {
                       if (geo.city === 'Amsterdam') provider += ' - DC2/DC4';
                       else if (geo.city === 'Miami') provider += ' - DC1/DC3';
                       else if (geo.city === 'Singapore') provider += ' - DC5';
                    }
                    
                    telegramLocation = `${locStr} (${telegramIp})`;
                    if (provider) {
                      telegramLocation += ` [${provider}]`;
                    }
                  }
                }
              }
            } catch (e) {}

            let msg = `📊 <b>System Ping Test Results</b>\n👤 <i>Triggered by: ${requesterName}</i>\n📍 <i>Test executed on ${sourceRegion}</i>\n\n<b>Telegram Webhook Server</b>\n└ 📍 <i>${telegramLocation}</i>\n   ✅ ONLINE | Webhook | Incoming Command\n\n`;
            
            for (const [groupName, groupData] of Object.entries(grouped)) {
              msg += `<b>${groupName}</b>\n└ 📍 <i>${groupData.loc}</i>\n`;
              for (const item of groupData.items) {
                msg += `   ${item.status} | ${item.latency}ms | ${item.name}\n`;
              }
              msg += '\n';
            }
            
            await sendTelegramMessage(chatId, msg.trim());
          } catch (error) {
            console.error('Ping test error:', error);
            await sendTelegramMessage(chatId, "🔴 <b>Error:</b> Failed to complete ping test.");
          }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error handling Telegram webhook:', error);
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}
