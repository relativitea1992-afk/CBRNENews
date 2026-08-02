import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

export interface TriageResult {
  isRelevant: boolean;
  headline: string;
  summary: string;
  lat: number | null;
  lng: number | null;
  type: string;
}

export async function triageNewsArticle(articleText: string): Promise<TriageResult | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set');
    return null;
  }

  const prompt = `
You are a CBRNE (Chemical, Biological, Radiological, Nuclear, and Explosives) threat analyst for Singapore.
Analyze the following news text and determine if it represents a threat (including odour incidents, toxic smells, leaks, potential releases) that could impact mainland Singapore.
Consider incidents in Singapore, or nearby border regions like Johor (e.g. Pasir Gudang), Batam, Riau that could cross borders via air/water.

Return the result strictly as a JSON object with the following fields:
- "isRelevant" (boolean): true if it represents a relevant CBRNE/Odour threat to Singapore, false otherwise.
- "headline" (string): A concise, punchy headline for the alert.
- "summary" (string): A 1-2 sentence summary of the incident and its potential impact on Singapore.
- "lat" (number or null): Latitude of the incident location. Null if unknown.
- "lng" (number or null): Longitude of the incident location. Null if unknown.
- "type" (string): Classify as "Chemical", "Biological", "Radiological", "Nuclear", "Explosive", "Odour", or "Unknown".

News text:
"""
${articleText}
"""
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    if (response.text) {
      const result = JSON.parse(response.text) as TriageResult;
      return result;
    }
  } catch (error) {
    console.error('Gemini AI Triage Error:', error);
  }
  return null;
}
