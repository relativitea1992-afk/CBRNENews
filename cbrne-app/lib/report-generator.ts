import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { geminiGenerate, checkAllModels } from '@/lib/gemini-client';
import { extract } from '@extractus/article-extractor';

export const maxDuration = 300;
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
      
      // Strip out the extra metrics for cleaner Telegram output
      outcome = outcome.replace(/ \| Models: .*? \| Ingress: \d+ bytes/g, '');
      outcome = outcome.replace(/ \| Models: [^|]+/g, '');
      outcome = outcome.replace(/ \| Ingress: \d+ bytes/g, '');
      outcome = outcome.replace(/ \| Egress: \d+ bytes/g, '');
      outcome = outcome.replace(/ \| Compute: .*$/g, '');

      // Consolidate individual source names under "NewsAPI"
      outcome = outcome.replace(/\(([^)]+)\)/, (match: string, inner: string) => {
        if (inner.includes(':')) {
          // Parse source breakdown and consolidate non-CNA/ST under NewsAPI
          const parts = inner.split(', ');
          const consolidated: Record<string, number> = {};
          for (const part of parts) {
            const [src, count] = part.split(': ');
            if (src && count) {
              const key = (src === 'CNA' || src === 'ST RSS') ? src : 'NewsAPI';
              consolidated[key] = (consolidated[key] || 0) + parseInt(count);
            }
          }
          const result = Object.entries(consolidated).map(([s, c]) => `${s}: ${c}`).join(', ');
          return `(${result})`;
        }
        return match;
      });

      // Escape raw text first
      outcome = escapeHtml(outcome);
      outcome = outcome.replace(/ via /g, '\nProcessed via ')
                       .replace(/ \| Tokens Consumed:/g, '\nTokens Consumed:')
                       .replace(/ \| Words: \d+/g, '')
                       .replace(/\. Found/g, '.\nFound')
                       .replace(/\. No relevant threats/g, '.\nNo relevant threats')
                       .replace(/\. Threats detected!/g, '.\nThreats detected!');
      const icon = run.status === 'SUCCESS' ? '✅' : '❌';
      checkedLines += `${icon} <b>News Fetched:</b> ${run.createdAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n<b>Outcome:</b> ${outcome}\n\n`;
    }
    newsStatusMsg = checkedLines.trim();
  }

  let ingressBytes = 0;

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

  // 3. Check NewsAPI Linkage + extract multiple articles with pre-filter
  let newsApiStatus = 'Unknown';
  let newsApiTopContent = '';
  const allArticles: { source: string, headline: string, url: string }[] = [];
  const RELEVANCE_KEYWORDS = /singapore|johor|batam|southeast asia|cbrne|chemical|biological|radiological|nuclear|explosive|haze|air quality|smog|odour|toxic|leak|pollution|psi|pm2\.5/i;
  try {
    const newsApiKey = process.env.NEWSAPI_KEY;
    if (newsApiKey) {
      const start = Date.now();
      const res = await fetch(`https://newsapi.org/v2/everything?q=singapore&sortBy=publishedAt&language=en&pageSize=10&apiKey=${newsApiKey}`);
      const latency = Date.now() - start;
      if (res.ok) {
        newsApiStatus = `✅ ONLINE (${latency}ms)`;
        const text = await res.text();
        ingressBytes += Buffer.byteLength(text, 'utf8');
        const data = JSON.parse(text);
        if (data.articles?.length > 0) {
          // Pre-filter: only include articles with potential CBRNE/haze/SG relevance
          for (const article of data.articles) {
            const text = [article.title, article.description, article.content].filter(Boolean).join(' ');
            if (RELEVANCE_KEYWORDS.test(text)) {
              allArticles.push({ source: 'NewsAPI', headline: article.title, url: article.url });
              newsApiTopContent += `[NewsAPI] ${article.title}. ${article.description || ''}\n\n`;
            }
          }
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
        ingressBytes += Buffer.byteLength(xml, 'utf8');
        const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          const title = titleMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
          if (!cnaHeadlines.has(title)) {
            cnaHeadlines.add(title);
            uniqueHeadlinesWithSource.push({ source: feed.name, headline: title });

            let url = '';
            const linkMatch = xml.match(new RegExp(`<item[^>]*>[\\s\\S]*?<title>[^<]*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*<\\/title>[\\s\\S]*?<link>([\\s\\S]*?)<\\/link>`, 'i'));
            if (linkMatch) {
              url = linkMatch[1].replace(/^<!\\[CDATA\\[/, '').replace(/\\]\\]>$/, '').trim();
            }
            allArticles.push({ source: `CNA ${feed.name}`, headline: title, url });

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
        ingressBytes += Buffer.byteLength(xml, 'utf8');
        const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          const title = titleMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
          if (!stHeadlines.has(title)) {
            stHeadlines.add(title);
            uniqueStHeadlinesWithSource.push({ source: feed.name, headline: title });

            let url = '';
            const linkMatch = xml.match(new RegExp(`<item[^>]*>[\\s\\S]*?<title>[^<]*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*<\\/title>[\\s\\S]*?<link>([\\s\\S]*?)<\\/link>`, 'i'));
            if (linkMatch) {
              url = linkMatch[1].replace(/^<!\\[CDATA\\[/, '').replace(/\\]\\]>$/, '').trim();
            }
            allArticles.push({ source: `ST ${feed.name}`, headline: title, url });

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

  // 5b. Check Gov.sg Environmental APIs
  let govSgStatus = 'Unknown';
  let pm25Readings: Record<string, number> = {};
  let previousPm25Readings: Record<string, number> = {};
  try {
    const dateStr = new Date(Date.now() + 8*60*60*1000).toISOString().split('T')[0];
    const start = Date.now();
    const envDataPromise = await Promise.all([
      fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=' + dateStr).then(res => res.text()).then(text => { ingressBytes += Buffer.byteLength(text, 'utf8'); return JSON.parse(text); }).catch(() => null),
      fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-direction?date=' + dateStr).then(res => res.text()).then(text => { ingressBytes += Buffer.byteLength(text, 'utf8'); return JSON.parse(text); }).catch(() => null),
      fetch('https://api-open.data.gov.sg/v2/real-time/api/pm25?date=' + dateStr).then(res => res.text()).then(text => { ingressBytes += Buffer.byteLength(text, 'utf8'); return JSON.parse(text); }).catch(() => null)
    ]);
    const latency = Date.now() - start;

    const [speedData, dirData, pm25Data] = envDataPromise;

    const extractStationStatus = (data: any, expectedTotal: number = 17) => {
      if (!data || !data.data || !data.data.stations || !data.data.readings) return { total: expectedTotal, active: 0, missing: [] };
      const stations = data.data.stations;
      const readings = data.data.readings;
      const total = Math.max(stations.length, expectedTotal);
      
      if (readings.length === 0) return { total, active: 0, missing: stations.map((s: any) => ({ name: s.name, downSince: 'start of day' })) };

      const missingInfo: any[] = [];
      let activeCount = 0;
      
      const latestApiTime = new Date(readings[0].timestamp).getTime();

      for (const station of stations) {
        let lastSeenIndex = -1;
        for (let i = 0; i < readings.length; i++) {
            const rData = readings[i].data || [];
            if (rData.some((d: any) => d.stationId === station.id)) {
                lastSeenIndex = i;
                break;
            }
        }
        
        if (lastSeenIndex === -1) {
            missingInfo.push({ name: station.name, downSince: 'start of day' });
        } else {
            const lastSeenTime = new Date(readings[lastSeenIndex].timestamp).getTime();
            const delayMinutes = (latestApiTime - lastSeenTime) / (1000 * 60);
            
            // 15-minute grace period for delayed sensor updates
            if (delayMinutes > 15) {
                // Determine when it first went missing
                let downSince = readings[0].timestamp;
                if (lastSeenIndex - 1 >= 0) {
                    downSince = readings[lastSeenIndex - 1].timestamp;
                }
                
                let timeStr = downSince;
                if (downSince.includes('T')) {
                    timeStr = downSince.split('T')[1].substring(0, 5);
                }
                missingInfo.push({ name: station.name, downSince: timeStr });
            } else {
                activeCount++;
            }
        }
      }

      return { total, active: activeCount, missing: missingInfo };
    };
    
    const extractPm25Status = (data: any) => {
      if (!data || !data.data || !data.data.items || data.data.items.length === 0) return { total: 5, active: 0, missing: [{name: 'ALL', downSince: 'API data unavailable'}] };
      const items = data.data.items;
      const latestReading = items[0];
      const keys = Object.keys(latestReading?.readings?.pm25_one_hourly || {});
      const active = keys.length;
      
      const expectedRegions = ['north', 'south', 'east', 'west', 'central'];
      const missingRegions = expectedRegions.filter(r => !keys.includes(r));
      
      const missingInfo = missingRegions.map(region => {
        let downSince = latestReading.timestamp;
        for (let i = 0; i < items.length; i++) {
            const rKeys = Object.keys(items[i]?.readings?.pm25_one_hourly || {});
            if (rKeys.includes(region)) {
                if (i - 1 >= 0) downSince = items[i - 1].timestamp;
                break;
            } else if (i === items.length - 1) {
                downSince = 'start of day';
            }
        }
        
        let timeStr = downSince;
        if (downSince.includes('T')) {
            timeStr = downSince.split('T')[1].substring(0, 5);
        }
        return { name: region, downSince: timeStr };
      });

      return { total: 5, active, missing: missingInfo };
    };

    const speedStats = extractStationStatus(speedData, 17);
    const dirStats = extractStationStatus(dirData, 17);
    const pmStats = extractPm25Status(pm25Data);

    let combinedDown: string[] = [];
    let speedOnlyDown: string[] = [];
    let dirOnlyDown: string[] = [];

    const dirMissingMap = new Map(dirStats.missing.map((m: any) => [m.name, m.downSince]));

    for (const s of speedStats.missing) {
        if (dirMissingMap.has(s.name)) {
            const dSince = dirMissingMap.get(s.name);
            const timeStr = (s.downSince === dSince) ? s.downSince : s.downSince;
            combinedDown.push(`${s.name} since ${timeStr}`);
            dirMissingMap.delete(s.name);
        } else {
            speedOnlyDown.push(`${s.name} since ${s.downSince}`);
        }
    }
    for (const [name, downSince] of Array.from(dirMissingMap.entries())) {
        dirOnlyDown.push(`${name} since ${downSince}`);
    }

    let windSpeedMsg = `Wind Speed: ${speedStats.active}/${speedStats.total} OK`;
    if (speedOnlyDown.length > 0) windSpeedMsg += ` (Down: ${speedOnlyDown.join(', ')})`;
    
    let windDirMsg = `Wind Direction: ${dirStats.active}/${dirStats.total} OK`;
    if (dirOnlyDown.length > 0) windDirMsg += ` (Down: ${dirOnlyDown.join(', ')})`;
    
    let combinedMsg = '';
    if (combinedDown.length > 0) {
        combinedMsg = `\n  • Down for both wind speed and wind direction: ${combinedDown.join(', ')}`;
    }

    const pmMissingStr = pmStats.missing.map((m: any) => `${m.name} since ${m.downSince}`);
    let pm25Msg = `PM2.5: ${pmStats.active}/${pmStats.total} OK`;
    if (pmMissingStr.length > 0) pm25Msg += ` (Down: ${pmMissingStr.join(', ')})`;

    govSgStatus = `✅ ONLINE (${latency}ms)\n  • ${windSpeedMsg}\n  • ${windDirMsg}${combinedMsg}\n  • ${pm25Msg}`;

    // Extract raw PM2.5 readings for use in threats section
    if (pm25Data?.data?.items?.length > 0) {
      const latestPmItem = pm25Data.data.items[0];
      pm25Readings = latestPmItem?.readings?.pm25_one_hourly || {};
      
      if (pm25Data.data.items.length > 1) {
        previousPm25Readings = pm25Data.data.items[1]?.readings?.pm25_one_hourly || {};
      } else {
        // Only 1 reading today (e.g. just past midnight), fetch yesterday's last reading for the trend
        try {
          const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleString('en-CA', { timeZone: 'Asia/Singapore' }).split(',')[0];
          const prevDayRes = await fetch('https://api-open.data.gov.sg/v2/real-time/api/pm25?date=' + yesterdayStr);
          const prevDayText = await prevDayRes.text();
          ingressBytes += Buffer.byteLength(prevDayText, 'utf8');
          const prevDayData = JSON.parse(prevDayText);
          if (prevDayData?.data?.items?.length > 0) {
            // Newest readings are first (index 0)
            previousPm25Readings = prevDayData.data.items[0]?.readings?.pm25_one_hourly || {};
          }
        } catch (e) {
          console.error("Failed to fetch previous day's PM2.5 data for trend:", e);
        }
      }
    }
  } catch (error: any) {
    govSgStatus = `❌ FAILED (${error.message || 'Unknown'})`;
  }

  // 6. Check Overall Compute on Vercel
  const memoryUsage = process.memoryUsage();
  const memoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
  const vercelRegion = process.env.VERCEL_REGION || 'Local/Unknown';
  const computeStatus = `✅ Region: ${vercelRegion} | RAM: ${memoryMB}MB`;

  // 7. Check for relevant incidents in the past 24 hours (Cluster aware)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Find all active cluster IDs that had an update in the last 24h
  const recentUpdates = await prisma.incident.findMany({
    where: {
      createdAt: { gte: twentyFourHoursAgo },
      isRelevant: true,
    },
    select: { clusterId: true, id: true }
  });
  
  const activeClusterIds = [...new Set(recentUpdates.map(t => t.clusterId || t.id))];

  // Fetch all incidents for these active clusters (limit to past 7 days to avoid unbounded growth)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const clusteredThreats = await prisma.incident.findMany({
    where: {
      OR: [
        { clusterId: { in: activeClusterIds } },
        { id: { in: activeClusterIds } } // Fallback for old standalone incidents
      ],
      isRelevant: true,
      createdAt: { gte: sevenDaysAgo }
    },
    orderBy: { publishedAt: 'asc' },
  });

  const clusters: Record<string, typeof clusteredThreats> = {};
  clusteredThreats.forEach(t => {
    const key = t.clusterId || t.id;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(t);
  });

  const numClusters = Object.keys(clusters).length;

  let threatSection = '';
  let clusterTimelineContext = '';

  if (numClusters > 0) {
    threatSection = `\n<b>🚨 Active Threat Events (Updated Past 24hr):</b> ${numClusters}\n`;
    
    // Format threat section & build timeline context for Gemini
    let count = 0;
    for (const [clusterId, incidents] of Object.entries(clusters)) {
      if (count < 3) {
        const latestIncident = incidents[incidents.length - 1];
        const type = latestIncident.type;
        const numUpdates = incidents.length;
        const timeStr = new Date(latestIncident.publishedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        
        threatSection += `• [${timeStr}] <b>[${type}]</b> ${latestIncident.headline} <i>(${numUpdates} update${numUpdates > 1 ? 's' : ''})</i>\n`;
      }
      
      clusterTimelineContext += `\n[Threat Event: ${incidents[0].type}]\n`;
      incidents.forEach(i => {
         const timelineTimeStr = new Date(i.publishedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
         clusterTimelineContext += `- [${timelineTimeStr}] ${i.headline}\n`;
      });
      
      count++;
    }
    
    if (numClusters > 3) {
      threatSection += `<i>...and ${numClusters - 3} more active events</i>\n`;
    }

    // Show live PM2.5 readings if any haze/air quality threat is active
    const hasHazeThreat = clusteredThreats.some(t => /haze|air quality/i.test(t.type || ''));
    if (hasHazeThreat && Object.keys(pm25Readings).length > 0) {
      const liveTimeStr = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', hour12: true });
      threatSection += `\n🌫️ <b>Live PM2.5 Readings (${liveTimeStr}):</b>\n`;
      const regions = ['north', 'south', 'east', 'west', 'central'];
      const row1 = regions.slice(0, 3).map(r => `${r.charAt(0).toUpperCase() + r.slice(1)}: ${pm25Readings[r] ?? 'N/A'}`).join(' | ');
      const row2 = regions.slice(3).map(r => `${r.charAt(0).toUpperCase() + r.slice(1)}: ${pm25Readings[r] ?? 'N/A'}`).join(' | ');
      threatSection += `  ${row1}\n  ${row2}\n`;
      
      // Calculate Stats
      const currentVals = Object.values(pm25Readings).filter(v => typeof v === 'number');
      const prevVals = Object.values(previousPm25Readings).filter(v => typeof v === 'number');
      
      if (currentVals.length > 0) {
        const min = Math.min(...currentVals);
        const max = Math.max(...currentVals);
        const avg = Math.round(currentVals.reduce((a, b) => a + b, 0) / currentVals.length);
        
        let trendStr = '';
        if (prevVals.length > 0) {
          const prevAvg = Math.round(prevVals.reduce((a, b) => a + b, 0) / prevVals.length);
          if (avg > prevAvg) trendStr = ` (⬆️ +${avg - prevAvg} from last hr)`;
          else if (avg < prevAvg) trendStr = ` (⬇️ ${avg - prevAvg} from last hr)`;
          else trendStr = ` (➖ Unchanged)`;
        }
        
        threatSection += `  <i>Stats: Min ${min} | Max ${max} | Avg ${avg}${trendStr}</i>\n`;
      }
      
      threatSection += `  <i>Ref: Normal (0-55) · Elevated (56-150) · High (151-250) · Very High (&gt;250)</i>\n`;
    }
  } else {
    threatSection = `\n💚 <b>No CBRNE threats detected (Past 24hr)</b>\n`;
  }

  // Run extracted news through Gemini for CBRNE assessment & top headline selection
  let heartbeatSection = `\n<b>💓 Heartbeat — Top News Pulse:</b>\n`;
  
  let totalSelectionTokens = 0, selectionPromptTokens = 0, selectionCandidateTokens = 0;
  let selectionModel = 'Unknown';
  let totalAssessmentTokens = 0, assessmentPromptTokens = 0, assessmentCandidateTokens = 0;
  let assessmentModel = 'Unknown';

  let newsApiPulse = '';
  let cnaPulse = '';
  let stPulse = '';
  let geminiAssessmentHtml = '';

  if (newsApiTopContent || cnaTopContent || stTopContent) {
    try {
      const newsContent = [
        newsApiTopContent ? `[NewsAPI Articles]\n${newsApiTopContent.trim()}` : '',
        cnaTopContent ? `[CNA Articles]\n${cnaTopContent.trim()}` : '',
        stTopContent ? `[Straits Times Articles]\n${stTopContent.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      
      // 1. Run Gemini Selection First
      const geminiSelection = await geminiGenerate({
          contents: `You are a CBRNE threat analyst monitoring Singapore. Note: You must also treat Haze, Air Quality, and Odour incidents as relevant threats.
Below are the top extracted news articles from live feeds.
Task: Review ALL sources — [NewsAPI Articles], [CNA Articles], and [Straits Times Articles]. For each source, select the 2 most relevant headlines (prioritizing CBRNE, Haze, Air Quality, and Odour). If there's no obvious relevance, just select the top 2 major news. If a source has no articles, return an empty array for it.

CRITICAL INSTRUCTION: You must assess the similarity of the 6 headlines you select across ALL sources. If two or more headlines are reporting on the same exact event or are highly similar, drop the duplicates and select the next most relevant, unique headline from that source. The final selection of headlines MUST be diverse and cover different events.

Output ONLY a valid raw JSON object (without markdown blocks) in the following structure:
{
  "newsApiTop2": [{"source": "Topic Category", "headline": "Headline string"}],
  "cnaTop2": [{"source": "Topic Category", "headline": "Headline string"}],
  "stTop2": [{"source": "Topic Category", "headline": "Headline string"}]
}

News Content:
${newsContent}`,
          config: { responseMimeType: "application/json" }
      });

      let selectionResult: any = { newsApiTop2: [], cnaTop2: [], stTop2: [] };
      try {
        const selectionRaw = geminiSelection.text?.trim() || '{}';
        const selectionMatch = selectionRaw.match(/\{[\s\S]*\}/);
        const cleanSelectionJson = selectionMatch ? selectionMatch[0] : '{}';
        selectionResult = JSON.parse(cleanSelectionJson);
      } catch (e) {
        console.error("Gemini Selection JSON parsing failed, using fallback.", e);
        const newsApiArticles = allArticles.filter(a => a.source === 'NewsAPI').slice(0, 2);
        const cnaArticles = allArticles.filter(a => a.source.startsWith('CNA')).slice(0, 2);
        const stArticles = allArticles.filter(a => a.source.startsWith('ST')).slice(0, 2);
        
        selectionResult = {
          newsApiTop2: newsApiArticles.map(a => ({ source: a.source, headline: a.headline })),
          cnaTop2: cnaArticles.map(a => ({ source: a.source, headline: a.headline })),
          stTop2: stArticles.map(a => ({ source: a.source, headline: a.headline }))
        };
      }

      // 2. Extract Full Text for Selected Articles
      const selectedUrls: string[] = [];
      const addUrls = (arr: any[]) => {
        if (arr && arr.length > 0) {
          arr.forEach((item: any) => {
             const matched = allArticles.find(a => a.headline.includes(item.headline) || item.headline.includes(a.headline));
             if (matched && matched.url) selectedUrls.push(matched.url);
          });
        }
      };
      addUrls(selectionResult.newsApiTop2);
      addUrls(selectionResult.cnaTop2);
      addUrls(selectionResult.stTop2);

      let fullTextContext = '';
      await Promise.all(selectedUrls.map(async (url) => {
          try {
             const extracted = await extract(url);
             if (extracted && extracted.content) {
                ingressBytes += Buffer.byteLength(extracted.content, 'utf8');
                const clean = extracted.content.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').substring(0, 4000);
                fullTextContext += `[URL: ${url}]\n${clean}\n\n`;
             }
          } catch(e) {
             console.error('Failed to extract:', url);
          }
      }));

      // 3. Run Gemini Assessment on Full Text
      let pm25Context = '';
      if (Object.keys(pm25Readings).length > 0) {
        pm25Context = `\nLive PM2.5 Readings (Singapore):\n` + Object.entries(pm25Readings).map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`).join(' | ') + `\n`;
      }

      const geminiAssessmentResponse = await geminiGenerate({
          contents: `You are a CBRNE threat analyst monitoring Singapore. Note: You must also treat Haze, Air Quality, and Odour incidents as relevant threats.
Below are the top extracted news articles from live feeds, as well as timelines of ongoing active threat events.
Task 1: Provide a detailed threat assessment. First, review the new live articles for immediate threats. You MUST include a short summary explaining why the reviewed articles are assessed to be relevant or not relevant as a threat to Singapore. ONLY include detailed analysis for relevant threats (CBRNE + Haze / Air Quality / Odour). If ALL articles are non-threats (e.g., standard accidents, generic crime, kidnappings, general infrastructure faults), do NOT list them individually; instead, provide a single consolidated sentence stating that all recent articles were reviewed and no CBRNE/environmental threats were detected, followed by a short summary of why they are not relevant to Singapore. If there is a mix, provide detailed analysis for the relevant threats (including why they are relevant to Singapore) and consolidate the non-threats into one brief sentence (including why they are not relevant). YOU MUST USE EXACTLY TWO HTML LINE BREAKS (<br><br>) after this consolidated sentence before beginning the next section. Then, review the [Active Threat Timelines] below. If there are active tracked threats, state their timeline and provide updates based on the latest articles. Ensure all dates/times mentioned in the timeline are in a clear, human-readable format (e.g. "Aug 9, 12:55 PM"). Do not output raw UTC timestamps.
Task 2: Provide a general security posture analysis for Singapore. Keep it extremely brief (e.g., "Normal") if no threat.
Task 3: Provide an actionable advisory based strictly on the assessment (or "None"). If there are live PM2.5 readings provided, you MUST explicitly reference the current PM2.5 levels (e.g. "Given the current PM2.5 levels are in the Normal range (max 36), no immediate action is required...") and factor them into your advisory.

Output ONLY a valid raw JSON object. DO NOT wrap it in any markdown blocks. DO NOT wrap it in a parent object. The top-level keys MUST BE EXACTLY these three strings:
{
  "assessment": "Detailed assessment html...",
  "generalPosture": "Security posture html...",
  "advisory": "Advisory html..."
}

Note: In the HTML fields, you may use standard Telegram HTML tags like <b> for bolding. Do NOT use markdown (**). When using common widely known acronyms, use ONLY the acronym.

New Articles (Full Text):
${fullTextContext || newsContent}

Active Threat Timelines:
${clusterTimelineContext || 'No ongoing clustered threats.'}
${pm25Context}`,
          config: { responseMimeType: "application/json" }
      });

      let assessmentResult: any = {};
      try {
        const assessmentRaw = geminiAssessmentResponse.text?.trim() || '{}';
        const assessmentMatch = assessmentRaw.match(/\{[\s\S]*\}/);
        const cleanAssessmentJson = assessmentMatch ? assessmentMatch[0] : '{}';
        assessmentResult = JSON.parse(cleanAssessmentJson);
      } catch (e) {
        console.error("Gemini Assessment JSON parsing failed.", e);
        assessmentResult = {
          assessment: "<i>Automated assessment temporarily unavailable due to parsing error. Please review the top headlines manually.</i>",
          generalPosture: "Unknown",
          advisory: "None"
        };
      }

      if (selectionResult.newsApiTop2 && selectionResult.newsApiTop2.length > 0) {
        selectionResult.newsApiTop2.forEach((item: any) => {
          newsApiPulse += `📰 <b>NewsAPI (${item.source}):</b> ${item.headline}\n`;
        });
      }
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

      const finalAssessment = assessmentResult.assessment || assessmentResult.DetailedAssessment || assessmentResult['Detailed Assessment'] || '';
      const finalPosture = assessmentResult.generalPosture || assessmentResult.GeneralPosture || assessmentResult['General Security Posture'] || '';
      const finalAdvisory = assessmentResult.advisory || assessmentResult.Advisory || '';
      
      let finalAssessmentStr = finalAssessment;
      if (!finalAssessment && !finalPosture && !finalAdvisory) {
         finalAssessmentStr = `<pre>${JSON.stringify(assessmentResult, null, 2)}</pre>`;
      }

      geminiAssessmentHtml = `
1. <b>Detailed Assessment:</b>
${finalAssessmentStr}

2. <b>General Security Posture:</b>
${finalPosture}

3. <b>Advisory:</b>
${finalAdvisory}`;

      const selectionTokenStr = geminiSelection.usageMetadata?.totalTokenCount 
        ? ` (${geminiSelection.modelUsed}, Tokens: ${geminiSelection.usageMetadata.totalTokenCount} [In: ${geminiSelection.usageMetadata.promptTokenCount}, Out: ${geminiSelection.usageMetadata.candidatesTokenCount}])`
        : ` (${geminiSelection.modelUsed})`;

      const assessmentTokenStr = geminiAssessmentResponse.usageMetadata?.totalTokenCount 
        ? ` (${geminiAssessmentResponse.modelUsed}, Tokens: ${geminiAssessmentResponse.usageMetadata.totalTokenCount} [In: ${geminiAssessmentResponse.usageMetadata.promptTokenCount}, Out: ${geminiAssessmentResponse.usageMetadata.candidatesTokenCount}])`
        : ` (${geminiAssessmentResponse.modelUsed})`;
        
      totalSelectionTokens = geminiSelection.usageMetadata?.totalTokenCount || 0;
      selectionPromptTokens = geminiSelection.usageMetadata?.promptTokenCount || 0;
      selectionCandidateTokens = geminiSelection.usageMetadata?.candidatesTokenCount || 0;
      selectionModel = geminiSelection.modelUsed || 'Unknown';
      totalAssessmentTokens = geminiAssessmentResponse.usageMetadata?.totalTokenCount || 0;
      assessmentPromptTokens = geminiAssessmentResponse.usageMetadata?.promptTokenCount || 0;
      assessmentCandidateTokens = geminiAssessmentResponse.usageMetadata?.candidatesTokenCount || 0;
      assessmentModel = geminiAssessmentResponse.modelUsed || 'Unknown';

      threatSection += heartbeatSection.replace('Top News Pulse:', `Top News Pulse${selectionTokenStr}:`);
      threatSection += newsApiPulse || `📰 <b>NewsAPI:</b> <i>No relevant headlines</i>\n`;
      threatSection += cnaPulse || `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
      threatSection += stPulse || `🗞️ <b>ST RSS:</b> <i>No headlines available</i>\n`;
      threatSection += `\n🤖 <b>Gemini Assessment${assessmentTokenStr}:</b>\n<i>${geminiAssessmentHtml.trim()}</i>\n`;
      
    } catch (e: any) {
      console.error('Gemini parsing error:', e);
      // Fallback if parsing fails or all models unavailable
      threatSection += heartbeatSection;
      threatSection += `📰 <b>NewsAPI:</b> <i>Error parsing headlines</i>\n`;
      threatSection += `📡 <b>CNA RSS:</b> <i>Error parsing top headlines</i>\n`;
      threatSection += `🗞️ <b>ST RSS:</b> <i>Error parsing top headlines</i>\n`;
      threatSection += `\n🤖 <b>Gemini Assessment:</b> <i>Unavailable or Error (${e.message})</i>\n`;
    }
  } else {
    // No content at all
    threatSection += heartbeatSection;
    threatSection += `📰 <b>NewsAPI:</b> <i>No headlines available</i>\n`;
    threatSection += `📡 <b>CNA RSS:</b> <i>No headlines available</i>\n`;
    threatSection += `🗞️ <b>ST RSS:</b> <i>No headlines available</i>\n`;
  }

  // 8. Construct the Hourly Report Messages (Split to bypass 4096 char limit)
  const reportMsgPart1 = `📊 <b>SYSTEM HOURLY REPORT (Part 1/2)</b> 📊

<b>News Monitoring Cron Job</b>
${newsStatusMsg}
${threatSection}`;

  const reportMsgPart2 = `📊 <b>SYSTEM HOURLY REPORT (Part 2/2)</b> 📊

<b>System Linkages & APIs</b>
<b>Gemini AI Engine:</b>
${geminiStatusSection}<b>NewsAPI Link:</b> ${newsApiStatus}
<b>CNA RSS Link:</b> ${cnaRssStatus}
<b>ST RSS Link:</b> ${stRssStatus}
<b>Gov sg Env APIs:</b> ${govSgStatus}
<b>Supabase Link:</b> ${supabaseStatus}

<i>Report generated automatically.</i>`;

  let egressBytes = 0;
  // 6. Send to Telegram sequentially
  if (process.env.TELEGRAM_CHAT_ID) {
    let telegramPayloadSize = 0;
    try {
      const payloadStr1 = JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: reportMsgPart1 });
      const payloadStr2 = JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: reportMsgPart2 });
      telegramPayloadSize = Buffer.byteLength(payloadStr1, 'utf8') + Buffer.byteLength(payloadStr2, 'utf8');
    } catch(e) {}
    
    // Send Part 1
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, reportMsgPart1);
    // Send Part 2
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, reportMsgPart2);
    
    egressBytes += telegramPayloadSize;
  }

  // Return metrics for logging
  return {
    ingressBytes,
    egressBytes,
    totalSelectionTokens,
    selectionPromptTokens,
    selectionCandidateTokens,
    selectionModel,
    totalAssessmentTokens,
    assessmentPromptTokens,
    assessmentCandidateTokens,
    assessmentModel
  };
}
