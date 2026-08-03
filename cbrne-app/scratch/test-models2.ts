import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

async function run() {
  const models = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.0-flash'];
  for (const model of models) {
    try {
      console.log('Testing', model);
      const res = await ai.models.generateContent({
        model,
        contents: 'reply with hello',
      });
      console.log(model, 'SUCCESS:', res.text);
    } catch (e: any) {
      console.error(model, 'FAILED', e.status, e.message);
    }
  }
}

run().catch(console.error);
