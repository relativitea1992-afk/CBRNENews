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
  advisory?: string;
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
- "advisory" (string): Provide an actionable advisory highlighting potential impacts to specific Singaporean regions or residents (e.g. Punggol residents) based on the incident details (such as wind direction). Analyze the exact risk (e.g., toxicity, flammability, radiation) if information is available. Clearly state what residents should do if they are INDOORS (e.g., close windows, turn off AC) and what they should do if they are OUTDOORS (e.g., seek shelter, avoid the area). Furthermore, include specific CBRNE medical advice (e.g., decontamination steps like washing with soap and water, symptoms to watch out for, when to seek emergency medical attention, or specific first-aid measures depending on the exact chemical, biological, or radiological agent). Use the exact string [BREAK] to separate these points into clear paragraphs (e.g. Risk, Indoors, Outdoors, Medical Advice). Do not use actual line breaks or newline characters in the JSON string.
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
      model: 'gemini-3.5-flash',
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
      
      const result = JSON.parse(cleanText) as TriageResult;
      if (result.advisory) {
        result.advisory = result.advisory.replace(/\[BREAK\]/g, '\n\n');
      }
      return result;
    }
  } catch (error) {
    console.error('Gemini AI Triage Error:', error);
  }
  return null;
}
