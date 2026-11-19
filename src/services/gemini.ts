import type {
  DiscoverUrlsRequest,
  DiscoverUrlsResponse,
  ExtractUrlRequest,
  ExtractUrlResponse,
  GenerateSchemaRequest,
  GenerateSchemaResponse,
  VerifySessionRequest,
  VerifySessionResponse,
} from '../types';

export class GeminiServiceError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status = 500, code = 'REQUEST_FAILED', retryable = false) {
    super(message);
    this.name = 'GeminiServiceError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function postJson<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
  signal?: AbortSignal
): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage =
        (body && typeof body.error === 'string' && body.error) ||
        `Request failed with status ${response.status}`;
      const code = (body && typeof body.code === 'string' && body.code) || 'HTTP_ERROR';
      const retryable = Boolean(body?.retryable) || response.status === 429 || response.status >= 500;
      throw new GeminiServiceError(errorMessage, response.status, code, retryable);
    }

    return body as TResponse;
  } catch (err) {
    if (err instanceof GeminiServiceError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (signal?.aborted) {
        throw new GeminiServiceError('Extraction cancelled by user.', 499, 'ABORTED', false);
      }
      throw new GeminiServiceError(
        'Request timed out after 60 seconds. Please retry.',
        504,
        'TIMEOUT',
        true
      );
    }
    throw new GeminiServiceError(
      err instanceof Error ? err.message : 'Network error communicating with extraction server.',
      0,
      'NETWORK_ERROR',
      true
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function generateSchemaApi(
  req: GenerateSchemaRequest,
  signal?: AbortSignal
): Promise<GenerateSchemaResponse> {
  return postJson<GenerateSchemaRequest, GenerateSchemaResponse>('/api/schema', req, signal);
}

export async function discoverUrlsApi(
  req: DiscoverUrlsRequest,
  signal?: AbortSignal
): Promise<DiscoverUrlsResponse> {
  return postJson<DiscoverUrlsRequest, DiscoverUrlsResponse>('/api/discover', req, signal);
}

export async function extractUrlApi(
  req: ExtractUrlRequest,
  signal?: AbortSignal
): Promise<ExtractUrlResponse> {
  return postJson<ExtractUrlRequest, ExtractUrlResponse>('/api/extract', req, signal);
}

export async function verifySessionApi(
  req: VerifySessionRequest,
  signal?: AbortSignal
): Promise<VerifySessionResponse> {
  return postJson<VerifySessionRequest, VerifySessionResponse>('/api/auth/verify-session', req, signal);
}
