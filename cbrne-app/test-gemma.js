process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  const prompt1 = `
You are a CBRNE threat analyst.
Return the result strictly as a JSON object with the following fields:
- "isRelevant" (boolean)
- "lat" (number or null)
- "lng" (number or null)
`;
  try {
    const res = await ai.models.generateContent({ 
      model: 'gemma-4-31b-it', 
      contents: prompt1,
      config: { responseMimeType: 'application/json' }
    });
    console.log('Success!', res.text);
  } catch (e) {
    console.log('Error for Gemma:', e.status || e.httpStatusCode, '| Msg:', e.message);
  }
}
test();
