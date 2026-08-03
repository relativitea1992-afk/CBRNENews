import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

// Priority-ordered list of models to try. If the first model fails (rate limit,
// unavailable, etc.), the next one is attempted automatically.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3-flash',
  'gemini-2.5-flash',
];

export interface GeminiRequestOptions {
  contents: string;
  config?: Record<string, any>;
}

export interface GeminiResponse {
  text: string | undefined;
  modelUsed: string;
}

/**
 * Calls Gemini with automatic model fallback. Tries each model in the
 * fallback chain until one succeeds or all fail.
 */
export async function geminiGenerate(options: GeminiRequestOptions): Promise<GeminiResponse> {
  let lastError: any = null;

  for (const model of MODEL_FALLBACK_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: options.contents,
        ...(options.config ? { config: options.config } : {}),
      });
      return { text: response.text, modelUsed: model };
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.httpStatusCode;
      const message = error?.message || '';

      // Retry on rate limit (429), server errors (5xx), or model not found (404)
      if (status === 429 || status === 503 || status === 404 ||
          (status && status >= 500) ||
          message.includes('rate') || message.includes('quota') ||
          message.includes('not found') || message.includes('unavailable')) {
        console.warn(`Gemini model "${model}" failed (${status || message}), trying next model...`);
        continue;
      }

      // For other errors (e.g. bad request, auth), don't retry with another model
      throw error;
    }
  }

  // All models exhausted
  throw lastError || new Error('All Gemini models failed');
}

export { ai, MODEL_FALLBACK_CHAIN };
