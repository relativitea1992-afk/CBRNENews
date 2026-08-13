process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
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
Local authorities reported a massive chemical fire at a factory in Pasir Gudang, Johor today. Thick black smoke has been billowing into the sky and citizens are advised to stay indoors.
"""
`;
  try {
    const res = await ai.models.generateContent({ 
      model: 'gemma-4-31b-it', 
      contents: prompt1,
      config: { responseMimeType: 'application/json' }
    });
    console.log('Success! RAW TEXT:', JSON.stringify(res.text));
  } catch (e) {
    console.log('Error for Gemma:', e.status || e.httpStatusCode, '| Msg:', e.message);
  }
}
test();
