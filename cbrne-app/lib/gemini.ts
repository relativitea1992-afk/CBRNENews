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
  pass2UsageMetadata?: any;
  pm25Readings?: Record<string, number>;
  previousPm25Readings?: Record<string, number>;
}

export interface BatchTriageResult {
  index: number;
  isRelevant: boolean;
  lat: number | null;
  lng: number | null;
}

export async function triageNewsBatch(articles: { title: string, content: string }[]): Promise<{ results: BatchTriageResult[], modelUsed: string, usageMetadata: any } | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set');
    return null;
  }
  
  if (articles.length === 0) return { results: [], modelUsed: 'Unknown', usageMetadata: null };

  let articlesText = '';
  articles.forEach((article, idx) => {
    articlesText += `Article ${idx}:\nTitle: ${article.title}\nContent: ${article.content}\n\n`;
  });

  const prompt1 = `
You are a CBRNE (Chemical, Biological, Radiological, Nuclear, and Explosives) threat analyst for Singapore.
Analyze the following batch of news articles and determine if each represents a threat (including odour incidents, toxic smells, leaks, potential releases, haze, or poor air quality) that could impact mainland Singapore.
Consider incidents in Singapore, or nearby border regions like Johor (e.g. Pasir Gudang), Batam, Riau that could cross borders via air/water.

Return the result STRICTLY as a JSON array of objects.
Each object MUST have the following fields:
- "index" (number): The exact index of the article in the provided list.
- "isRelevant" (boolean): true if it represents a relevant CBRNE/Odour/Haze threat to Singapore, false otherwise.
- "lat" (number | null): Precise Latitude of the SPECIFIC incident location (e.g., exact school, building, facility, or street). Do NOT use the generic geographic center of Singapore (1.3521) unless the location is completely unspecified. Null if unknown or not relevant.
- "lng" (number | null): Precise Longitude of the SPECIFIC incident location. Do NOT use the generic geographic center of Singapore (103.8198) unless the location is completely unspecified. Null if unknown or not relevant.

Articles:
"""
${articlesText}
"""
`;

  try {
    const response1 = await geminiGenerate({
      contents: prompt1,
      config: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              isRelevant: { type: "boolean" },
              lat: { type: "number", nullable: true },
              lng: { type: "number", nullable: true }
            },
            required: ["index", "isRelevant"]
          }
        }
      }
    });
    
    if (!response1 || !response1.text) return null;

    let cleanText = response1.text.trim();
    const firstBrace = cleanText.indexOf('[');
    const lastBrace = cleanText.lastIndexOf(']');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
    const results = JSON.parse(cleanText) as BatchTriageResult[];
    return {
      results,
      modelUsed: response1.modelUsed || 'Unknown',
      usageMetadata: response1.usageMetadata
    };
  } catch (error) {
    console.error('Gemini AI Triage Error (Batch Pass 1):', error);
    return null;
  }
}

export async function triageRelevantArticlePass2(
  articleText: string, 
  pass1Result: { lat: number | null, lng: number | null, modelUsed: string, usageMetadata: any }
): Promise<TriageResult | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const dateStr = new Date(Date.now() + 8*60*60*1000).toISOString().split('T')[0];
  const envDataPromise = Promise.all([
    fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed?date=' + dateStr).then(res => res.json()),
    fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-direction?date=' + dateStr).then(res => res.json()),
    fetch('https://api-open.data.gov.sg/v2/real-time/api/pm25?date=' + dateStr).then(res => res.json())
  ]).catch(e => {
    console.error('Failed to fetch environmental data:', e);
    return [null, null, null];
  });
  
  const result1 = { isRelevant: true, lat: pass1Result.lat, lng: pass1Result.lng };
  let metadata1 = pass1Result.usageMetadata;
  let model1 = pass1Result.modelUsed;

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

      // Distance-based assessment for far-away incidents
      const SG_CENTER_LAT = 1.3521;
      const SG_CENTER_LNG = 103.8198;
      const distToSG = getDistance(result1.lat!, result1.lng!, SG_CENTER_LAT, SG_CENTER_LNG);

      // Calculate bearing from incident to Singapore
      const getBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const dLon = deg2rad(lon2 - lon1);
        const y = Math.sin(dLon) * Math.cos(deg2rad(lat2));
        const x = Math.cos(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) -
                  Math.sin(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.cos(dLon);
        return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
      };

      const bearingToSG = getBearing(result1.lat!, result1.lng!, SG_CENTER_LAT, SG_CENTER_LNG);
      const bearingLabel = getBlowingTowards(bearingToSG + 180); // Convert "towards" bearing to a "from" direction for getBlowingTowards

      if (distToSG > 200 && latestStData) {
        // Far-away incident: provide pre-computed factual distance analysis
        // Get the actual wind speed and direction from the closest SG station
        const latestSpdReading = latestSpeedReadings.find((s: any) => s.stationId === closestStation.id);
        const latestDirReading = latestDirReadings.find((d: any) => d.stationId === closestStation.id);
        const sgWindSpeedKmh = latestSpdReading ? (latestSpdReading.value * 1.852) : 0;
        const sgWindDirDeg = latestDirReading?.value ?? null;
        const sgWindBlowingTowards = sgWindDirDeg !== null ? getBlowingTowards(sgWindDirDeg) : 'unknown';

        // Calculate if wind at Singapore is blowing FROM the direction of the incident
        // i.e., would wind carry hazard from incident towards Singapore?
        // Bearing from incident to SG tells us the direction hazard would need to travel
        // Wind "blowing towards" direction tells us where wind carries things
        let windAligned = false;
        let travelTimeHrs = Infinity;
        if (sgWindSpeedKmh > 0) {
          travelTimeHrs = distToSG / sgWindSpeedKmh;
          // Check if the wind direction at the incident location would push towards SG
          // The hazard needs to travel in the direction of bearingToSG
          // Wind blows towards (sgWindDirDeg+180)%360
          if (sgWindDirDeg !== null) {
            const windTowardsDeg = (sgWindDirDeg + 180) % 360;
            let angleDiff = Math.abs(bearingToSG - windTowardsDeg);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            windAligned = angleDiff < 60; // Within 60° cone
          }
        }

        const travelTimeStr = travelTimeHrs === Infinity ? 'incalculable (no wind)' :
          travelTimeHrs > 48 ? `~${Math.round(travelTimeHrs)} hours (${(travelTimeHrs / 24).toFixed(1)} days)` :
          `~${Math.round(travelTimeHrs)} hours`;

        windContext = `\n\nDISTANCE ASSESSMENT (PRE-COMPUTED — USE THESE FACTS EXACTLY, DO NOT FABRICATE STATION DATA):
The incident is located ${Math.round(distToSG)} km from Singapore (direction: ${bearingLabel} of Singapore).
Singapore weather station reference: ${closestStation.name} (Singapore-based, Lat: ${closestStation.location.latitude}, Lng: ${closestStation.location.longitude})
Current wind at Singapore: ${sgWindSpeedKmh.toFixed(1)} km/h blowing towards ${sgWindBlowingTowards}
Wind alignment towards Singapore from incident: ${windAligned ? 'YES — wind could carry hazard towards Singapore' : 'NO — wind is not blowing from the incident direction towards Singapore'}
Estimated travel time at current wind speed: ${travelTimeStr}
Will likely affect Singapore within 24 hours: ${(windAligned && travelTimeHrs <= 24) ? 'POSSIBLE' : 'UNLIKELY'}

IMPORTANT RULES FOR YOUR ADVISORY:
- You MUST state the distance (${Math.round(distToSG)} km) from the incident to Singapore.
- You MUST reference ONLY the Singapore-based station "${closestStation.name}" as your wind data source. Do NOT invent or reference any other weather station.
- You MUST state the current Singapore wind speed (${sgWindSpeedKmh.toFixed(1)} km/h) and direction (blowing towards ${sgWindBlowingTowards}).
- You MUST state the estimated travel time (${travelTimeStr}) and whether it will likely affect Singapore within 24 hours.
- If it will NOT affect Singapore within 24 hours, state: "Based on the distance of ${Math.round(distToSG)} km and current wind conditions (${sgWindSpeedKmh.toFixed(1)} km/h blowing towards ${sgWindBlowingTowards}), this hazard is unlikely to affect Singapore within the next 24 hours."`;

        if (pastHourSummary) {
          windContext += `\n${pastHourSummary}\n`;
        }

      } else if (latestStData) {
        // Nearby incident: provide full station data for detailed projection
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
  let pm25Readings: Record<string, number> = {};
  let previousPm25Readings: Record<string, number> = {};
  if (pm25Data && pm25Data.data && pm25Data.data.items && pm25Data.data.items.length > 0) {
    const pmItems = pm25Data.data.items;
    const latestPm = pmItems[0];
    const histPm = pmItems.length > 1 ? pmItems[1] : null;
    pm25Readings = latestPm?.readings?.pm25_one_hourly || {};
    if (histPm) previousPm25Readings = histPm?.readings?.pm25_one_hourly || {};

    windContext += `\n\nREGIONAL PM2.5 AIR QUALITY DATA:\nTimestamp: ${latestPm.timestamp}\nReadings: ${JSON.stringify(latestPm.readings?.pm25_one_hourly || {})}\n`;
    if (histPm) {
      windContext += `\nHISTORICAL PM2.5 (~1 hour ago):\nTimestamp: ${histPm.timestamp}\nReadings: ${JSON.stringify(histPm.readings?.pm25_one_hourly || {})}\n`;
    }
    windContext += `\nIf this is a haze or air quality incident, explicitly incorporate these PM2.5 readings into your threat assessment. Highlight specific regions (North, South, East, West, Central) that currently have unhealthy or high levels of PM2.5. IMPORTANT RULE: For Haze / Air Quality threats, perform the actual "Wind Projection" calculation to track the plume. However, ONLY IF the provided PM2.5 readings for Singapore show that multiple regions are currently in the Elevated, High, or Very High bands (> 55), indicating widespread haze already covering Singapore rather than an incoming localized plume, you MUST still include the "Wind Projection:" heading but explicitly state the reason why the calculation is excluded (e.g., "Wind projection calculation is excluded as the PM2.5 levels in Singapore are widely elevated across multiple regions, indicating widespread haze rather than a localized plume."). If the PM2.5 levels within Singapore are Normal (0-55), you MUST perform the Wind Projection calculation to track the incoming plume.
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
  - **Wind Projection:** You must act as a geospatial vector engine. Evaluate if a wind projection is warranted based on the physical properties of the identified threat (e.g., if it is an airborne chemical/biological/radiological release, odour, haze, or a bomb threat used to disperse CBRNE agents, a wind projection IS warranted). If warranted, calculate the direction the hazard will travel based on the wind data and the SOURCE LOCATION relative to Singapore:
    - Explicitly mention the SOURCE location and format its name EXACTLY as a special markdown tag like this: [Source Name](MAP:LAT,LNG).
    - Explicitly state the provided mathematically closest weather station and its exact data (wind speed and blowing towards direction) as the basis for your projection. Format it EXACTLY as a special markdown tag like this: [Station Name](MAP:LAT,LNG). Do not output the raw Lat/Lng text anywhere else.
    - State the wind direction by indicating where it is blowing TOWARDS (e.g., "blowing north", "blowing southeast"). 
    - State the wind speed in km/h.
    - If the physical math shows the hazard will NOT hit Singapore, you MUST state "Based on the wind vector, the hazard will travel away from Singapore. No impact is expected."
    - If it does hit Singapore, project the exact impact area 30 mins and 1 hr from now (assuming similar wind speed and direction across the time frame), naming the specific townships.
    - IMPORTANT RULE: If the threat type does NOT require a wind projection (e.g. bomb threat, bomb hoax, contained indoor incidents with no airborne release), or if it is widespread haze with multiple/no unhealthy PM2.5 regions, you MUST still include the "Wind Projection:" heading and explicitly state the reason/assessment why wind projection is excluded (e.g., "Wind projection is excluded as this is a localized explosive threat with no expected airborne release").
  - **Risk:** Highlight potential impacts to specific Singaporean regions or residents based on the incident details. 
  - **Indoors:** Clearly state what residents should do if they are INDOORS.
  - **Outdoors:** Clearly state what residents should do if they are OUTDOORS.
  - **Medical Advice:** Include specific CBRNE medical advice. 
  - IMPORTANT: You MUST explicitly include the headings (e.g., "Wind Projection:", "Risk:", "Indoors:", "Outdoors:", "Medical Advice:") at the beginning of each corresponding section. Use the exact string [BREAK] to separate these sections. Do not use actual line breaks or newline characters in the JSON string.
- "type" (string): Classify as "Chemical", "Biological", "Radiological", "Nuclear", "Explosive", "Odour", "Haze / Air Quality", or "Unknown".

News text:
"""
${articleText}
"""${windContext}
`;

  try {
    const response2 = await geminiGenerate({
      contents: prompt2,
      config: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            summary: { type: "string" },
            advisory: { type: "string" },
            type: { type: "string" }
          },
          required: ["headline", "summary", "type"]
        }
      }
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
        usageMetadata: combinedUsage,
        pass2UsageMetadata: response2.usageMetadata,
        pm25Readings,
        previousPm25Readings
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
): Promise<{ clusterId: string | null, usageMetadata?: any, modelUsed?: string } | null> {
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
    const response = await geminiGenerate({ 
      contents: prompt, 
      config: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: "object",
          properties: {
            isSameEvent: { type: "boolean" },
            clusterId: { type: "string" }
          },
          required: ["isSameEvent"]
        }
      } 
    });
    if (!response || !response.text) return null;
    const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned);
    
    if (result.isSameEvent && result.clusterId) {
       return { clusterId: result.clusterId, usageMetadata: response.usageMetadata, modelUsed: response.modelUsed };
    }
    return { clusterId: null, usageMetadata: response.usageMetadata, modelUsed: response.modelUsed };
  } catch (error) {
    console.error('Error clustering incident with Gemini:', error);
  }
  
  return null;
}
