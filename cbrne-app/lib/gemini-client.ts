import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

// Priority-ordered list of models to try. If the first model fails (rate limit,
// unavailable, etc.), the next one is attempted automatically.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
];

export interface GeminiRequestOptions {
  contents: string;
  config?: Record<string, any>;
}

export interface GeminiResponse {
  text: string | undefined;
  modelUsed: string;
  usageMetadata?: any;
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
      return { text: response.text, modelUsed: model, usageMetadata: response.usageMetadata };
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.httpStatusCode;
      const message = error?.message || '';

      // Retry on anything EXCEPT 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden)
      if (status === 400 || status === 401 || status === 403) {
        throw error;
      }

      console.warn(`Gemini model "${model}" failed (${status || 'Network/Unknown'} - ${message}), trying next model...`);
      continue;
    }
  }

  // All models exhausted
  throw lastError || new Error('All Gemini models failed');
}

export interface ModelStatus {
  model: string;
  status: 'online' | 'rate_limited' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * Pings every model in the fallback chain individually and returns
 * per-model status. Used for the hourly system report.
 */
export async function checkAllModels(): Promise<ModelStatus[]> {
  const promises = MODEL_FALLBACK_CHAIN.map(async (model) => {
    try {
      const start = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents: 'Reply with "OK" if you are online.',
      });
      const latencyMs = Date.now() - start;

      return { model, status: 'online' as const, latencyMs };
    } catch (error: any) {
      const code = error?.status || error?.httpStatusCode;
      if (code === 429) {
        return { model, status: 'rate_limited' as const };
      } else if (code === 404) {
        return { model, status: 'error' as const, error: 'Not found' };
      } else {
        return { model, status: 'error' as const, error: `${code || 'Fail'}` };
      }
    }
  });

  return Promise.all(promises);
}

export { ai, MODEL_FALLBACK_CHAIN };
