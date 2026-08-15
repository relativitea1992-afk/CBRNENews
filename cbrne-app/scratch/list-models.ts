import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

async function run() {
  try {
    console.log('Fetching models...');
    const models = await ai.models.list();
    for await (const model of models) {
      console.log(`Name: ${model.name}, DisplayName: ${model.displayName}`);
    }
  } catch (e) {
    console.error('Failed:', e);
  }
}
run();
