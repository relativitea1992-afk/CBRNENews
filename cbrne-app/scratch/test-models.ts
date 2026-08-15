import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

async function testModel(model: string) {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: 'Reply OK',
    });
    console.log(`Model ${model}: OK (${response.text?.trim()})`);
  } catch (err: any) {
    console.error(`Model ${model} error: ${err.message || err}`);
  }
}

async function main() {
  await testModel('gemini-3.7-flash');
  await testModel('gemini-3.5-flash');
  await testModel('gemini-3.0-flash');
  await testModel('gemini-3-flash');
}

main();
