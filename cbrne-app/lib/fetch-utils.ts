/**
 * A wrapper around the native fetch API that adds a timeout.
 * If the request takes longer than the specified timeout (in milliseconds),
 * it will throw an Error with name "TimeoutError".
 */
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 60000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error(`Timeout of ${timeoutMs}ms exceeded`)), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError' || error.message?.includes('Timeout')) {
      const timeoutError = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  }
}
