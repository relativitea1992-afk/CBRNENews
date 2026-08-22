import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

// Priority-ordered list of models to try. If the first model fails (rate limit,
// unavailable, etc.), the next one is attempted automatically.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
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
  rateLimitedModels?: string[];
}

/**
 * Returns true for models that do NOT support the responseSchema API parameter
 * (server-side constrained decoding). These models can still output JSON via
 * prompt instructions and responseMimeType, just not schema-enforced output.
 */
function isSchemaUnsupported(model: string): boolean {
  return model.startsWith('gemma');
}

/**
 * Calls Gemini with automatic model fallback. Tries each model in the
 * fallback chain until one succeeds or all fail.
 *
 * For models that don't support responseSchema (e.g. Gemma), the schema is
 * automatically stripped from the config. The prompts already contain JSON
 * format instructions, and callers already have JSON cleanup logic, so this
 * works transparently.
 */
export async function geminiGenerate(options: GeminiRequestOptions): Promise<GeminiResponse> {
  let lastError: any = null;
  const rateLimitedModels: string[] = [];

  for (const model of MODEL_FALLBACK_CHAIN) {
    try {
      // Build config — strip responseSchema for models that don't support it
      let config = options.config ? { ...options.config } : undefined;
      if (config && isSchemaUnsupported(model)) {
        const { responseSchema, ...rest } = config;
        if (responseSchema) {
          console.info(`[gemini-client] Stripping responseSchema for ${model} (unsupported). Using prompt-based JSON output.`);
        }
        config = Object.keys(rest).length > 0 ? rest : undefined;
      }

      const generatePromise = ai.models.generateContent({
        model,
        contents: options.contents,
        ...(config ? { config } : {}),
      });

      // Gemma models are slower — give them 60s; Gemini models get 30s
      const timeoutMs = isSchemaUnsupported(model) ? 60000 : 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout: Model ${model} took longer than ${timeoutMs / 1000}s to respond`)), timeoutMs);
      });

      const response = await Promise.race([generatePromise, timeoutPromise]) as any;

      return { text: response.text, modelUsed: model, usageMetadata: response.usageMetadata, rateLimitedModels };
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.httpStatusCode;
      const message = error?.message || '';

      if (status === 429) {
        rateLimitedModels.push(model);
      }

      // Hard-throw on auth errors (401, 403) — these won't resolve by retrying
      if (status === 401 || status === 403) {
        throw error;
      }

      // For 400 errors: only hard-throw if this is the FIRST model (likely a
      // genuinely malformed request). For fallback models, 400 may be a
      // capability gap (e.g. unsupported param we missed stripping), so we
      // continue to the next model.
      if (status === 400 && model === MODEL_FALLBACK_CHAIN[0]) {
        throw error;
      }

      console.warn(`[gemini-client] Model "${model}" failed (${status || 'Network/Unknown'} - ${message}), trying next model...`);
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
      await ai.models.get({ model });
      const latencyMs = Date.now() - start;

      return { model, status: 'online' as const, latencyMs };
    } catch (error: any) {
      const code = error?.status || error?.httpStatusCode;
      // Note: ai.models.get does not typically return 429 for generation limits,
      // but it will catch network or auth errors.
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
