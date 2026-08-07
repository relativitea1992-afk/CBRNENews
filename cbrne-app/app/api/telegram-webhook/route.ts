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

      let manualLogId: string | null = null;
      let manualEgressBytes = 0;
      
      const trackEgress = async (bytes: number) => {
         manualEgressBytes += bytes;
         if (manualLogId) {
            try {
              await prisma.systemLog.update({
                where: { id: manualLogId },
                data: { details: `Triggered by ${requesterName} (IP: ${telegramIp}) | Egress: ${manualEgressBytes} bytes` }
              });
            } catch(e) {}
         }
      };

      const sendTrackedMessage = async (c: string, t: string, o?: any) => {
         try {
           const payloadStr = JSON.stringify({ chat_id: c, text: t });
           await trackEgress(Buffer.byteLength(payloadStr, 'utf8'));
         } catch(e) {}
         return sendTelegramMessage(c, t, o);
      };

      // Log manual commands to SystemLog
      if (text.startsWith('/')) {
        const commandName = text.split(' ')[0];
        try {
          const log = await prisma.systemLog.create({
            data: {
              jobName: `manual-${commandName}`,
              status: 'SUCCESS',
              details: `Triggered by ${requesterName} (IP: ${telegramIp})`
            }
          });
        } catch (e) {
          console.error('Failed to log manual command:', e);
        }
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
          await sendTrackedMessage(chatId, "✅ <b>Status:</b> No active CBRNE/Odour threats detected in the last 24 hours.");
        } else {
          let msg = `⚠️ <b>Status:</b> ${activeIncidents.length} active threat(s) detected in the last 24 hours:\n\n`;
          activeIncidents.forEach((inc, idx) => {
            msg += `${idx + 1}. [${inc.type}] <a href="${inc.sourceUrl}">${inc.headline}</a>\n`;
          });
          await sendTrackedMessage(chatId, msg);
        }
      } else if (text.startsWith('/latest')) {
        const latestIncident = await prisma.incident.findFirst({
          where: { isRelevant: true },
          orderBy: { createdAt: 'desc' }
        });

        if (!latestIncident) {
          await sendTrackedMessage(chatId, "No relevant threats found in the database.");
        } else {
           let msg = `🔍 <b>LATEST THREAT</b>\n\n<b>Headline:</b> ${latestIncident.headline}\n<b>Type:</b> ${latestIncident.type}\n<b>Summary:</b> ${latestIncident.summary}`;
           
           if (latestIncident.advisory) {
             msg += `\n\n<b>Advisory:</b>\n${latestIncident.advisory}`;
           }
           
           msg += `\n\n<b>Model Used:</b> ${latestIncident.modelUsed || 'Unknown'}`;
           msg += `\n<b>Link:</b> ${latestIncident.sourceUrl}`;
           await sendTrackedMessage(chatId, msg, { lat: latestIncident.lat, lon: latestIncident.lng, type: latestIncident.type as any });
        }
      } else if (text.startsWith('/resource')) {
        await sendTrackedMessage(chatId, "⏳ <b>Generating resource consumption report...</b>");
        try {
          const oneDayAgo = DateTime.now().minus({ days: 1 }).toJSDate();
          
          // Housekeeping: delete logs older than 24 hours
          await prisma.systemLog.deleteMany({
            where: { createdAt: { lt: oneDayAgo } }
          });
          
          const logs = await prisma.systemLog.findMany({
            where: { createdAt: { gte: oneDayAgo } },
            orderBy: { createdAt: 'desc' }
          });
          
          const threats = await prisma.incident.count({
            where: { createdAt: { gte: oneDayAgo } }
          });
          
          let fetchNewsRuns = 0;
          let hourlyReportRuns = 0;
          let purgeRuns = 0;
          const manualRuns: Record<string, number> = {};
          
          let totalTokens = 0, promptTokens = 0, candidateTokens = 0;
          let triagingTokens = { total: 0, prompt: 0, candidate: 0 };
          let assessmentTokens = { total: 0, prompt: 0, candidate: 0 };
          let headlineTokens = { total: 0, prompt: 0, candidate: 0 };
          const modelsUsage: Record<string, { total: number, prompt: number, candidate: number }> = {};
          
          let articlesScanned = 0;
          let ingressBytes = 0;
          let egressBytes = 0;
          const sourceBreakdown: Record<string, number> = {};

          for (const log of logs) {
            if (log.jobName === 'fetch-news') {
              fetchNewsRuns++;
              
              const detail = log.details || '';
              // Verified: Total 50 new articles (Singapore: 20, World: 15, Asia: 15)
              const articlesMatch = detail.match(/Total (\d+) new articles/);
              if (articlesMatch) articlesScanned += parseInt(articlesMatch[1]);
              
              const breakdownMatch = detail.match(/\((.*?)\)/);
              if (breakdownMatch) {
                const parts = breakdownMatch[1].split(', ');
                for (const part of parts) {
                  const [src, count] = part.split(': ');
                  if (src && count) {
                    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + parseInt(count);
                  }
                }
              }
              
              const bandwidthMatch = detail.match(/Ingress: (\d+) bytes/);
              if (bandwidthMatch) ingressBytes += parseInt(bandwidthMatch[1]);
              
              const egressMatch = detail.match(/Egress: (\d+) bytes/);
              if (egressMatch) egressBytes += parseInt(egressMatch[1]);

              // | Tokens Consumed: 1234 [In: 1000, Out: 234] | Models: gemini-1.5-flash
              // Also supports old format: via Gemini [gemini-2.0-flash] | Tokens Consumed: 1234 [In: 1000, Out: 234]
              const tokenMatch = detail.match(/Tokens Consumed: (\d+) \[In: (\d+), Out: (\d+)\](?: \| Models: ([\w., -]+))?/);
              if (tokenMatch) {
                const tot = parseInt(tokenMatch[1]);
                const prm = parseInt(tokenMatch[2]);
                const cnd = parseInt(tokenMatch[3]);
                
                let modelString = tokenMatch[4];
                if (!modelString) {
                   const fallbackMatch = detail.match(/via (?:Gemini|AI|Gemma|Gemini & Gemma) \[(.*?)\]/);
                   if (fallbackMatch) {
                       modelString = fallbackMatch[1];
                   } else {
                       modelString = 'gemini-1.5-flash';
                   }
                }
                
                totalTokens += tot; promptTokens += prm; candidateTokens += cnd;
                triagingTokens.total += tot; triagingTokens.prompt += prm; triagingTokens.candidate += cnd;
                
                const models = modelString.split(',').map(s => s.trim());
                for (const mdl of models) {
                  if (!modelsUsage[mdl]) modelsUsage[mdl] = { total: 0, prompt: 0, candidate: 0 };
                  modelsUsage[mdl].total += tot; modelsUsage[mdl].prompt += prm; modelsUsage[mdl].candidate += cnd;
                  break; // attribute to first model to avoid double counting
                }
              }
            } else if (log.jobName === 'hourly-report') {
              hourlyReportRuns++;
              const detail = log.details || '';
              
              const bandwidthMatch = detail.match(/Ingress: (\d+) bytes/);
              if (bandwidthMatch) ingressBytes += parseInt(bandwidthMatch[1]);
              
              const egressMatch = detail.match(/Egress: (\d+) bytes/);
              if (egressMatch) egressBytes += parseInt(egressMatch[1]);
              
              // Tokens Consumed [Headline Selection: 10 [In: 5, Out: 5] (model-a) | Gemini Assessment: 20 [In: 10, Out: 10] (model-b)]
              const selectionMatch = detail.match(/Headline Selection: (\d+)(?: \[In: (\d+), Out: (\d+)\])? \(([\w.-]+)\)/);
              if (selectionMatch) {
                const tok = parseInt(selectionMatch[1]);
                const prm = selectionMatch[2] ? parseInt(selectionMatch[2]) : 0;
                const cnd = selectionMatch[3] ? parseInt(selectionMatch[3]) : 0;
                const mdl = selectionMatch[4];
                totalTokens += tok; promptTokens += prm; candidateTokens += cnd;
                headlineTokens.total += tok; headlineTokens.prompt += prm; headlineTokens.candidate += cnd;
                if (!modelsUsage[mdl]) modelsUsage[mdl] = { total: 0, prompt: 0, candidate: 0 };
                modelsUsage[mdl].total += tok; modelsUsage[mdl].prompt += prm; modelsUsage[mdl].candidate += cnd;
              }
              
              const assessMatch = detail.match(/Gemini Assessment: (\d+)(?: \[In: (\d+), Out: (\d+)\])? \(([\w.-]+)\)/);
              if (assessMatch) {
                const tok = parseInt(assessMatch[1]);
                const prm = assessMatch[2] ? parseInt(assessMatch[2]) : 0;
                const cnd = assessMatch[3] ? parseInt(assessMatch[3]) : 0;
                const mdl = assessMatch[4];
                totalTokens += tok; promptTokens += prm; candidateTokens += cnd;
                assessmentTokens.total += tok; assessmentTokens.prompt += prm; assessmentTokens.candidate += cnd;
                if (!modelsUsage[mdl]) modelsUsage[mdl] = { total: 0, prompt: 0, candidate: 0 };
                modelsUsage[mdl].total += tok; modelsUsage[mdl].prompt += prm; modelsUsage[mdl].candidate += cnd;
              }
            } else if (log.jobName === 'purge') {
              purgeRuns++;
            } else if (log.jobName.startsWith('manual-')) {
              manualRuns[log.jobName] = (manualRuns[log.jobName] || 0) + 1;
              const detail = log.details || '';
              const egressMatch = detail.match(/Egress: (\d+) bytes/);
              if (egressMatch) egressBytes += parseInt(egressMatch[1]);
            }
          }

          let dbSize = 'Unknown';
          try {
            const dbSizeResult: any[] = await prisma.$queryRaw`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
            dbSize = dbSizeResult[0]?.size || 'Unknown';
          } catch (dbErr) {
            console.error('Could not fetch DB size:', dbErr);
          }
          
          const allIncidentRows = await prisma.incident.count();
          const activeThreats24h = await prisma.incident.count({
            where: { isRelevant: true, createdAt: { gte: oneDayAgo } }
          });
          const logRows = await prisma.systemLog.count();

          const formatTokens = (t: number) => t.toLocaleString();
          const formatBytes = (b: number) => {
            if (b === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(b) / Math.log(k));
            return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
          };

          const dateOpts = { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions;
          const startStr = oneDayAgo.toLocaleString('en-SG', dateOpts);
          const endStr = new Date().toLocaleString('en-SG', dateOpts);
          let msg = `📊 <b>Resource & Infrastructure Report</b>\n`;
          msg += `<i>Report Window: ${startStr} to ${endStr}</i>\n\n`;
          msg += `🤖 <b>Automated Compute (Cron):</b>\n`;
          msg += `- Threat Scanner (/fetch-news): ${fetchNewsRuns} runs\n`;
          msg += `- System Heartbeat (/hourly-report): ${hourlyReportRuns} runs\n`;
          msg += `- Auto-Purge (/purge): ${purgeRuns} runs\n\n`;
          
          msg += `👤 <b>Manual Compute (Telegram):</b>\n`;
          let totalManual = 0;
          Object.entries(manualRuns).forEach(([cmd, cnt]) => {
            msg += `- ${cmd.replace('manual-', '')}: ${cnt} requests\n`;
            totalManual += cnt;
          });
          if (totalManual === 0) msg += `- No manual commands executed\n`;
          
          msg += `\n🧠 <b>AI Token Usage:</b>\n`;
          msg += `<b>By Model:</b>\n`;
          const sortedModels = Object.entries(modelsUsage).sort((a, b) => b[1].total - a[1].total);
          sortedModels.forEach(([mdl, usage]) => {
            msg += `- ${mdl}: ${formatTokens(usage.total)} [In: ${formatTokens(usage.prompt)} | Out: ${formatTokens(usage.candidate)}]\n`;
          });
          
          msg += `\n<b>By Function:</b>\n`;
          msg += `- Threat Triaging & Assessment: ${formatTokens(triagingTokens.total)} tokens [In: ${formatTokens(triagingTokens.prompt)} | Out: ${formatTokens(triagingTokens.candidate)}]\n`;
          msg += `- Hourly System Pulse Summary: ${formatTokens(assessmentTokens.total)} tokens [In: ${formatTokens(assessmentTokens.prompt)} | Out: ${formatTokens(assessmentTokens.candidate)}]\n`;
          msg += `- Headline Selection: ${formatTokens(headlineTokens.total)} tokens [In: ${formatTokens(headlineTokens.prompt)} | Out: ${formatTokens(headlineTokens.candidate)}]\n\n`;
          
          msg += `📰 <b>Data Processing & Ingress:</b>\n`;
          msg += `- Total Articles Scanned: ${articlesScanned}\n`;
          msg += `- New Threats Detected (24h): ${activeThreats24h}\n`;
          msg += `- Est. Data Transport (Ingress): ~${formatBytes(ingressBytes)}\n`;
          msg += `- Est. Data Transport (Egress): ~${formatBytes(egressBytes)}\n\n`;
          
          if (Object.keys(sourceBreakdown).length > 0) {
            msg += `<b>Articles By Source:</b>\n`;
            Object.entries(sourceBreakdown).forEach(([src, cnt]) => {
              msg += `- ${src}: ${cnt}\n`;
            });
          }
          
          msg += `\n💾 <b>Storage & Infrastructure:</b>\n`;
          msg += `- Total Database Size: ${dbSize}\n`;
          msg += `- Active Threats (Last 24h): ${activeThreats24h} rows\n`;
          msg += `- Total Analyzed URLs (All Time): ${allIncidentRows.toLocaleString()} rows\n`;
          msg += `- System Logs Retained: ${logRows.toLocaleString()} rows\n`;

          await sendTrackedMessage(chatId, msg);
        } catch (e: any) {
          console.error('Error generating resource report:', e);
          await sendTrackedMessage(chatId, `❌ <b>Failed to generate resource report:</b> ${e.message}`);
        }
      } else if (text.startsWith('/test')) {
        await sendTrackedMessage(chatId, "⏳ <b>Generating test report...</b> This may take a few seconds.");
        try {
          const { generateHourlyReport } = await import('../cron/hourly-report/route');
          await generateHourlyReport();
        } catch (e: any) {
          console.error('Error generating test hourly report:', e);
          await sendTrackedMessage(chatId, `❌ <b>Failed to generate test report:</b> ${e.message}`);
        }
      } else if (text.startsWith('/clear')) {
        const deleted = await prisma.incident.deleteMany({
          where: { isRelevant: true }
        });
        await sendTrackedMessage(chatId, `🧹 <b>Alerts Cleared:</b> ${deleted.count} active threat(s) have been removed from the dashboard.`);
      } else if (text.startsWith('/snapshot')) {
        const dashboardBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hazmat-scan.vercel.app';
        const dashboardUrl = `${dashboardBaseUrl}?snapshot=true`;
        const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(dashboardUrl)}&screenshot=true&meta=false&embed=screenshot.url&waitFor=%23map-ready&adblock=false&force=true`;
        
        await sendTrackedMessage(chatId, "📸 <b>Taking snapshot of the live dashboard...</b>");
        
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
              await sendTrackedMessage(chatId, "❌ Failed to send dashboard snapshot photo.");
            }
          } else {
            console.error('Failed to fetch snapshot from Microlink:', await imageReq.text());
            await sendTrackedMessage(chatId, "❌ Failed to generate dashboard snapshot.");
          }
        } catch (e) {
          console.error('Error generating snapshot:', e);
          await sendTrackedMessage(chatId, "❌ Error generating dashboard snapshot.");
        }
      } else if (text.startsWith('/pingtest')) {
        await sendTrackedMessage(chatId, "⏳ <b>Running System Diagnostics...</b>\nFetching IPs and calculating latency. This will take a few seconds.");
        
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

            const ping = async (group: string, name: string, urlStr: string, testFn: () => Promise<string | {loc?: string, label?: string} | void>) => {
              const start = Date.now();
              let status = '🔴 ERR';
              let latency = 0;
              let dynamicLoc: string | void = undefined;
              let resultName = name;
              try {
                const res = await testFn();
                if (typeof res === 'object' && res !== null) {
                  if (res.loc) dynamicLoc = res.loc;
                  if (res.label) resultName = res.label;
                } else if (typeof res === 'string') {
                  dynamicLoc = res;
                }
                latency = Date.now() - start;
                status = '🟢 OK';
              } catch (e) {
                latency = Date.now() - start;
              }
              const loc = dynamicLoc ? dynamicLoc : await getLocation(urlStr);
              return { group, name: resultName, status, latency, loc };
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
              }),
              ping('Gov SG Env APIs (Weather Station Data)', 'Wind Speed', 'https://api.data.gov.sg', async () => {
                const res = await fetch('https://api.data.gov.sg/v1/environment/wind-speed');
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gov SG Env APIs (Weather Station Data)', 'Wind Direction', 'https://api.data.gov.sg', async () => {
                const res = await fetch('https://api.data.gov.sg/v1/environment/wind-direction');
                if (!res.ok) throw new Error('Bad status');
              }),
              ping('Gov SG Env APIs (Weather Station Data)', 'PM 2.5', 'https://api.data.gov.sg', async () => {
                const res = await fetch('https://api.data.gov.sg/v1/environment/pm25');
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
            
            await sendTrackedMessage(chatId, msg.trim());
          } catch (error) {
            console.error('Ping test error:', error);
            await sendTrackedMessage(chatId, "🔴 <b>Error:</b> Failed to complete ping test.");
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
