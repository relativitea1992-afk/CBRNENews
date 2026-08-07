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

  let windContext = '';
  try {
    const [speedRes, dirRes] = await Promise.all([
      fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-speed'),
      fetch('https://api-open.data.gov.sg/v2/real-time/api/wind-direction')
    ]);
    const speedData = await speedRes.json();
    const dirData = await dirRes.json();
    
    // Pick the first few stations to give a general sense of the wind
    const latestSpeedReadings = speedData.data.readings[0]?.data || [];
    const latestDirReadings = dirData.data.readings[0]?.data || [];

    const stations = latestSpeedReadings.slice(0, 5).map((speedReading: any) => {
      const dirReading = latestDirReadings.find((d: any) => d.stationId === speedReading.stationId);
      // Map station ID to name for better context if possible, or just use ID
      const stationInfo = speedData.data.stations.find((s: any) => s.id === speedReading.stationId);
      const stationName = stationInfo ? stationInfo.name : speedReading.stationId;
      return `Station ${stationName}: Speed ${speedReading.value} knots, Direction ${dirReading ? dirReading.value : 'unknown'} degrees`;
    }).join('\n');
    
    windContext = `\n\nCURRENT WIND DATA (from api-open.data.gov.sg):\nTimestamp: ${speedData.data.readings[0]?.timestamp || speedData.data.timestamp || 'unknown'}\n${stations}\n\nPlease use this wind data to model and project the output for (1) the next 30 mins and (2) next 1 hour, where the threat would likely spread to, providing the actual impacted area via township in Singapore.`;
  } catch (e) {
    console.error('Failed to fetch wind data:', e);
  }

  const prompt = `
You are a CBRNE (Chemical, Biological, Radiological, Nuclear, and Explosives) threat analyst for Singapore.
Analyze the following news text and determine if it represents a threat (including odour incidents, toxic smells, leaks, potential releases) that could impact mainland Singapore.
Consider incidents in Singapore, or nearby border regions like Johor (e.g. Pasir Gudang), Batam, Riau that could cross borders via air/water.

Return the result strictly as a JSON object with the following fields:
- "isRelevant" (boolean): true if it represents a relevant CBRNE/Odour threat to Singapore, false otherwise.
- "headline" (string): A concise, punchy headline for the alert.
- "summary" (string): A detailed, comprehensive threat assessment of the incident. Explain the exact nature of the threat, its severity, and provide a thorough analysis of its potential impact on Singapore. (Do NOT include the plume projection here; put that in the advisory).
- "advisory" (string): Provide a highly detailed, actionable advisory based strictly on the threat assessment you just formulated. 
  - State the physical location of the identified source.
  - Identify the substance of the CBRNE threat and its physical properties.
  - Plume Projection: You must act as a strict geospatial vector engine. Calculate the direction the plume will travel based on the WIND DIRECTION (where it's blowing FROM) and the SOURCE LOCATION relative to Singapore.
    - If the wind blows FROM the South, it travels NORTH. A source in Singapore would blow OUT of Singapore into Malaysia.
    - If the wind blows FROM the North, it travels SOUTH. A source in Malaysia (e.g. Pasir Gudang) would blow INTO Singapore.
    - Explicitly state the data and reasoning used for the projection (e.g. "Wind is blowing from X degrees at Y knots. This means the plume travels towards Z. Since the source is at [location], this means...").
    - If the physical math shows the plume will NOT hit Singapore, you MUST state "Based on the wind vector, the plume will travel away from Singapore. No impact is expected."
    - If it does hit Singapore, model and project an output for (1) the next 30 mins and (2) next 1 hour, providing the actual impacted area via township.
  - Highlight potential impacts to specific Singaporean regions or residents (e.g. Punggol residents) based on the incident details. Analyze the exact risk (e.g., toxicity, flammability, radiation). Clearly state what residents should do if they are INDOORS (e.g., close windows, turn off AC) and what they should do if they are OUTDOORS (e.g., seek shelter, avoid the area). Furthermore, include specific CBRNE medical advice (e.g., decontamination steps like washing with soap and water, symptoms to watch out for, when to seek emergency medical attention, or specific first-aid measures depending on the exact agent). 
  - Use the exact string [BREAK] to separate these points into clear paragraphs (e.g. Source Location & Substance, Plume Projection, Risk, Indoors, Outdoors, Medical Advice). Do not use actual line breaks or newline characters in the JSON string.
- "lat" (number or null): Latitude of the incident location. Null if unknown.
- "lng" (number or null): Longitude of the incident location. Null if unknown.
- "type" (string): Classify as "Chemical", "Biological", "Radiological", "Nuclear", "Explosive", "Odour", or "Unknown".

News text:
"""
${articleText}
"""${windContext}
`;

  try {
    const response = await geminiGenerate({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    if (response.text) {
      let cleanText = response.text.trim();
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }
      
      try {
        const result = JSON.parse(cleanText) as TriageResult;
        if (result.advisory) {
          result.advisory = result.advisory.replace(/\[BREAK\]/g, '\n\n');
        }
        result.modelUsed = response.modelUsed;
        result.usageMetadata = response.usageMetadata;
        return result;
      } catch (parseError) {
        console.error('Failed to parse Gemini JSON:', cleanText);
        throw parseError;
      }
    }
  } catch (error) {
    console.error('Gemini AI Triage Error:', error);
  }
  return null;
}
