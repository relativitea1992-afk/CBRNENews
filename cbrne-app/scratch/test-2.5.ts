import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

async function run() {
  try {
    console.log('Testing gemini-2.5-flash...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Reply with "OK" if you are online.',
    });
    console.log('SUCCESS:', response.text);
  } catch (error: any) {
    console.error('FAILED. Status:', error?.status);
    console.error('Error Code:', error?.httpStatusCode);
    console.error('Message:', error?.message);
  }
}
run();
