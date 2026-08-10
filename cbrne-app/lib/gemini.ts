import { geminiGenerate } from './gemini-client';

export interface TriageResult {
  isRelevant: boolean;
  headline: string;
  summary: string;
  lat: number | null;
  lng: number | null;
  type: string;
  advisory?: string;
  modelUsed?: string;
  usageMetadata?: any;
}

export async function triageNewsArticle(articleText: string): Promise<TriageResult | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set');
    return null;
  }

  // 1. Fetch wind data concurrently with the first LLM pass
  const dateStr = new Date(Date.now() + 8*60*60*1000).toISOString().split('T')[0];
  const envDataPromise = Promise.all([
    fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=' + dateStr).then(res => res.json()),
    fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-direction?date=' + dateStr).then(res => res.json()),
    fetch('https://api-open.data.gov.sg/v2/real-time/api/pm25?date=' + dateStr).then(res => res.json())
  ]).catch(e => {
    console.error('Failed to fetch environmental data:', e);
    return [null, null, null];
  });

  // First LLM Pass: Extract location and relevance
  const prompt1 = `
You are a CBRNE (Chemical, Biological, Radiological, Nuclear, and Explosives) threat analyst for Singapore.
Analyze the following news text and determine if it represents a threat (including odour incidents, toxic smells, leaks, potential releases, haze, or poor air quality) that could impact mainland Singapore.
Consider incidents in Singapore, or nearby border regions like Johor (e.g. Pasir Gudang), Batam, Riau that could cross borders via air/water.

Return the result strictly as a JSON object with the following fields:
- "isRelevant" (boolean): true if it represents a relevant CBRNE/Odour/Haze threat to Singapore, false otherwise.
- "lat" (number or null): Latitude of the incident location. Null if unknown.
- "lng" (number or null): Longitude of the incident location. Null if unknown.

News text:
"""
${articleText}
"""
`;

  let result1: { isRelevant: boolean; lat: number | null; lng: number | null; };
  let metadata1: any;
  let model1: string = 'Unknown';
  try {
    const response1 = await geminiGenerate({
      contents: prompt1,
      config: { responseMimeType: 'application/json' }
    });
    
    if (!response1 || !response1.text) return null;
    
    let cleanText = response1.text.trim();
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
    result1 = JSON.parse(cleanText);
    metadata1 = response1.usageMetadata;
    model1 = response1.modelUsed || 'Unknown';
  } catch (error) {
    console.error('Gemini AI Triage Error (Pass 1):', error);
    return null;
  }

  if (!result1.isRelevant) {
    return { ...result1, headline: '', summary: '', type: 'Unknown', usageMetadata: metadata1, modelUsed: model1 };
  }

  // Calculate closest station and extract environmental data
  const [speedData, dirData, pm25Data] = await envDataPromise;
  let windContext = '';
  
  if (speedData && dirData && result1.lat !== null && result1.lng !== null) {
    const deg2rad = (deg: number) => deg * (Math.PI / 180);
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = deg2rad(lat2 - lat1);
      const dLon = deg2rad(lon2 - lon1);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const getBlowingTowards = (degreesFrom: number) => {
      const toDegrees = (degreesFrom + 180) % 360;
      const dirs = ["North", "North-Northeast", "Northeast", "East-Northeast", "East", "East-Southeast", "Southeast", "South-Southeast", "South", "South-Southwest", "Southwest", "West-Southwest", "West", "West-Northwest", "Northwest", "North-Northwest"];
      return dirs[Math.round((toDegrees % 360) / 22.5) % 16];
    };

    let closestStation: any = null;
    let minDistance = Infinity;

    const stations = speedData.data?.stations || [];
    for (const st of stations) {
      if (st.location && st.location.latitude && st.location.longitude) {
        const dist = getDistance(result1.lat, result1.lng, st.location.latitude, st.location.longitude);
        if (dist < minDistance) {
          minDistance = dist;
          closestStation = st;
        }
      }
    }

    if (closestStation) {
      const readingsLen = speedData.data?.readings?.length || 1;
      const latestIdx = 0;
      // Wind readings come every ~1 min; index 60 ≈ 1 hour ago
      const historicalIdx = Math.min(readingsLen - 1, 60);
      
      const latestSpeedReadings = speedData.data?.readings?.[latestIdx]?.data || [];
      const historicalSpeedReadings = speedData.data?.readings?.[historicalIdx]?.data || [];
      const latestDirReadings = dirData.data?.readings?.[latestIdx]?.data || [];
      const historicalDirReadings = dirData.data?.readings?.[historicalIdx]?.data || [];
      const latestTimestamp = speedData.data?.readings?.[latestIdx]?.timestamp || speedData.data?.timestamp || 'unknown';
      const historicalTimestamp = speedData.data?.readings?.[historicalIdx]?.timestamp || 'unknown';

      const processSingleStation = (stationId: string, stationInfo: any, speedReadings: any[], dirReadings: any[]) => {
        const speedReading = speedReadings.find((s: any) => s.stationId === stationId);
        const dirReading = dirReadings.find((d: any) => d.stationId === stationId);
        if (!speedReading) return null;

        const stationName = stationInfo.name;
        const lat = stationInfo.location.latitude;
        const lng = stationInfo.location.longitude;
        const speedKmh = (speedReading.value * 1.852).toFixed(1);
        
        let directionStr = 'unknown';
        if (dirReading && typeof dirReading.value === 'number') {
          directionStr = getBlowingTowards(dirReading.value);
        }
        return `Station ${stationName} (Lat: ${lat}, Lng: ${lng}): Speed ${speedKmh} km/h, Wind blowing towards ${directionStr}`;
      };

      const latestStData = processSingleStation(closestStation.id, closestStation, latestSpeedReadings, latestDirReadings);
      const histStData = processSingleStation(closestStation.id, closestStation, historicalSpeedReadings, historicalDirReadings);

      // Build past-1hr statistical summary for the closest station
      let pastHourSummary = '';
      const hourReadingsCount = Math.min(readingsLen, 61);
      const speeds: number[] = [];
      const windDirections: number[] = [];
      for (let i = 0; i < hourReadingsCount; i++) {
        const spdData = speedData.data?.readings?.[i]?.data || [];
        const dirDataArr = dirData.data?.readings?.[i]?.data || [];
        const spdReading = spdData.find((s: any) => s.stationId === closestStation.id);
        const dirReading = dirDataArr.find((d: any) => d.stationId === closestStation.id);
        if (spdReading && typeof spdReading.value === 'number') speeds.push(spdReading.value * 1.852);
        if (dirReading && typeof dirReading.value === 'number') windDirections.push(dirReading.value);
      }
      if (speeds.length > 1) {
        const minSpd = Math.min(...speeds).toFixed(1);
        const maxSpd = Math.max(...speeds).toFixed(1);
        const avgSpd = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1);
        pastHourSummary += `\nPAST 1-HOUR WIND SPEED STATS (${speeds.length} readings):\nMin: ${minSpd} km/h | Max: ${maxSpd} km/h | Avg: ${avgSpd} km/h`;
        
        const mid = Math.floor(speeds.length / 2);
        const recentAvg = speeds.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
        const olderAvg = speeds.slice(mid).reduce((a, b) => a + b, 0) / (speeds.length - mid);
        const spdDiff = recentAvg - olderAvg;
        if (Math.abs(spdDiff) > 0.5) {
          pastHourSummary += `\nSpeed Trend: ${spdDiff > 0 ? 'Increasing' : 'Decreasing'} (recent avg ${recentAvg.toFixed(1)} vs older avg ${olderAvg.toFixed(1)} km/h)`;
        } else {
          pastHourSummary += `\nSpeed Trend: Stable`;
        }
      }
      if (windDirections.length > 1) {
        const dirCounts: Record<string, number> = {};
        windDirections.forEach(d => {
          const label = getBlowingTowards(d);
          dirCounts[label] = (dirCounts[label] || 0) + 1;
        });
        const sorted = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]);
        const predominant = sorted[0][0];
        const consistency = ((sorted[0][1] / windDirections.length) * 100).toFixed(0);
        pastHourSummary += `\nPredominant Wind Direction (past 1hr): Blowing towards ${predominant} (${consistency}% of readings)`;
        if (sorted.length > 1) {
          pastHourSummary += ` | Secondary: towards ${sorted[1][0]} (${((sorted[1][1] / windDirections.length) * 100).toFixed(0)}%)`;
        }
      }

      if (latestStData) {
        windContext = `\n\nMATHEMATICALLY CLOSEST WEATHER STATION DATA:\nTimestamp: ${latestTimestamp}\n${latestStData}\n`;
        if (histStData) {
          windContext += `\nHISTORICAL TREND DATA FOR THIS STATION (~1 hour ago):\nTimestamp: ${historicalTimestamp}\n${histStData}\n`;
        }
        if (pastHourSummary) {
          windContext += `\n${pastHourSummary}\n`;
        }
        windContext += `\nPlease use ONLY this station's wind data to model and project the output for (1) the next 30 mins and (2) next 1 hour. Also, perform analysis considering the historical trend data AND the past 1-hour statistical summary (min/max/avg speed, speed trend, predominant direction consistency) to adjust the confidence of your wind speed and direction projection. Provide the actual impacted area via township in Singapore.`;
      }
    }
  }

  // Extract PM2.5 Data if available
  if (pm25Data && pm25Data.data && pm25Data.data.items && pm25Data.data.items.length > 0) {
    const pmItems = pm25Data.data.items;
    const latestPm = pmItems[0];
    const histPm = pmItems.length > 1 ? pmItems[1] : null;

    windContext += `\n\nREGIONAL PM2.5 AIR QUALITY DATA:\nTimestamp: ${latestPm.timestamp}\nReadings: ${JSON.stringify(latestPm.readings?.pm25_one_hourly || {})}\n`;
    if (histPm) {
      windContext += `\nHISTORICAL PM2.5 (~1 hour ago):\nTimestamp: ${histPm.timestamp}\nReadings: ${JSON.stringify(histPm.readings?.pm25_one_hourly || {})}\n`;
    }
    windContext += `\nIf this is a haze or air quality incident, explicitly incorporate these PM2.5 readings into your threat assessment. Highlight specific regions (North, South, East, West, Central) that currently have unhealthy or high levels of PM2.5. IMPORTANT RULE: For Haze / Air Quality threats, ONLY perform and include the "Wind Projection" section if there is EXACTLY ONE specific region with high/unhealthy PM2.5 levels. If there are multiple regions with high/unhealthy PM2.5, or if no regions are high/unhealthy, completely OMIT the Wind Projection section from your advisory. 
Additionally, for Haze/Air Quality threats, you MUST state the PM2.5 reference bands in your advisory (e.g., under Risk) so the user understands the severity: Normal (0-55), Elevated (56-150), High (151-250), Very High (>250).`;
  }

  // Second LLM Pass
  const prompt2 = `
You are a CBRNE (Chemical, Biological, Radiological, Nuclear, and Explosives) threat analyst for Singapore.
Analyze the following news text and provide a detailed threat assessment.
The incident has already been classified as relevant, and its coordinates are: Latitude ${result1.lat}, Longitude ${result1.lng}.

Return the result strictly as a JSON object with the following fields:
- "headline" (string): A concise, punchy headline for the alert.
- "summary" (string): A concise, high-level threat assessment of the incident (1-2 sentences maximum). State only the exact nature of the threat and its location. Do NOT duplicate information that will be covered in the Wind Projection, Risk, Indoors, Outdoors, or Medical Advice sections below.
- "advisory" (string): Provide an actionable advisory based strictly on the threat assessment. 
  - **Wind Projection:** (Include only if applicable based on the rules above). You must act as a geospatial vector engine. Calculate the direction the hazard will travel based on the wind data and the SOURCE LOCATION relative to Singapore.
    - Explicitly mention the SOURCE location and format its name EXACTLY as a special markdown tag like this: [Source Name](MAP:LAT,LNG).
    - Explicitly state the provided mathematically closest weather station and its exact data (wind speed and blowing towards direction) as the basis for your projection. Format it EXACTLY as a special markdown tag like this: [Station Name](MAP:LAT,LNG). Do not output the raw Lat/Lng text anywhere else.
    - State the wind direction by indicating where it is blowing TOWARDS (e.g., "blowing north", "blowing southeast"). 
    - State the wind speed in km/h.
    - If the physical math shows the hazard will NOT hit Singapore, you MUST state "Based on the wind vector, the hazard will travel away from Singapore. No impact is expected."
    - If it does hit Singapore, project the exact impact area 30 mins and 1 hr from now (assuming similar wind speed and direction across the time frame), naming the specific townships.
  - **Risk:** Highlight potential impacts to specific Singaporean regions or residents based on the incident details. 
  - **Indoors:** Clearly state what residents should do if they are INDOORS.
  - **Outdoors:** Clearly state what residents should do if they are OUTDOORS.
  - **Medical Advice:** Include specific CBRNE medical advice. 
  - IMPORTANT: You MUST explicitly include the headings (e.g., "Wind Projection:", "Risk:", "Indoors:", "Outdoors:", "Medical Advice:") at the beginning of each corresponding section. Use the exact string [BREAK] to separate these sections. Do not use actual line breaks or newline characters in the JSON string. If a section is omitted based on the rules (e.g., Wind Projection for widespread haze), do not include its heading.
- "type" (string): Classify as "Chemical", "Biological", "Radiological", "Nuclear", "Explosive", "Odour", "Haze / Air Quality", or "Unknown".

News text:
"""
${articleText}
"""${windContext}
`;

  try {
    const response2 = await geminiGenerate({
      contents: prompt2,
      config: { responseMimeType: 'application/json' }
    });
    
    if (response2 && response2.text) {
      let cleanText = response2.text.trim();
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }
      const result2 = JSON.parse(cleanText);
      if (result2.advisory) {
        result2.advisory = result2.advisory.replace(/\[BREAK\]/g, '\n\n');
      }
      
      const combinedUsage = {
        promptTokenCount: (metadata1?.promptTokenCount || 0) + (response2.usageMetadata?.promptTokenCount || 0),
        candidatesTokenCount: (metadata1?.candidatesTokenCount || 0) + (response2.usageMetadata?.candidatesTokenCount || 0),
        totalTokenCount: (metadata1?.totalTokenCount || 0) + (response2.usageMetadata?.totalTokenCount || 0)
      };

      return {
        isRelevant: result1.isRelevant,
        lat: result1.lat,
        lng: result1.lng,
        headline: result2.headline,
        summary: result2.summary,
        type: result2.type,
        advisory: result2.advisory,
        modelUsed: response2.modelUsed || model1,
        usageMetadata: combinedUsage
      };
    }
  } catch (error) {
    console.error('Gemini AI Triage Error (Pass 2):', error);
  }
  return null;
}

export async function clusterIncident(
  newHeadline: string,
  newSummary: string,
  newType: string,
  recentIncidents: { id: string, clusterId: string | null, headline: string, summary: string, type: string }[]
): Promise<{ clusterId: string | null, usageMetadata?: any } | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  
  // Filter incidents to match the exact same type as a basic heuristic
  const matchingTypeIncidents = recentIncidents.filter(i => i.type === newType);
  if (matchingTypeIncidents.length === 0) return null;
  
  const candidatesList = matchingTypeIncidents.map((t, idx) => 
    `[Candidate ${idx}] ClusterID: ${t.clusterId || t.id}\nHeadline: ${t.headline}\nSummary: ${t.summary}`
  ).join('\n\n');

  const prompt = `You are a CBRNE Intelligence Analyst. Your task is to determine if a newly detected news article refers to the EXACT SAME ongoing real-world event as any of the recent threats.

New Incident:
Headline: ${newHeadline}
Summary: ${newSummary}
Type: ${newType}

Recent Active Threats:
${candidatesList}

Rules:
1. ONLY group them if they are undeniably the same event (e.g. updates on the same chemical fire, same hazy period).
2. If it is a completely separate incident (even if similar type), do NOT group them.
3. If it matches, return the ClusterID of the match.

Output JSON format strictly:
{
  "isSameEvent": true,
  "clusterId": "the-matched-cluster-id"
}
OR
{
  "isSameEvent": false
}
`;

  try {
    const response = await geminiGenerate({ contents: prompt, config: { responseMimeType: 'application/json' } });
    if (!response || !response.text) return null;
    const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned);
    
    if (result.isSameEvent && result.clusterId) {
       return { clusterId: result.clusterId, usageMetadata: response.usageMetadata };
    }
    return { clusterId: null, usageMetadata: response.usageMetadata };
  } catch (error) {
    console.error('Error clustering incident with Gemini:', error);
  }
  
  return null;
}
