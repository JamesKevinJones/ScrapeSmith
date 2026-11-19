import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverUrlsForTopic,
  extractFromUrl,
  GeminiApiError,
  generateSchemaFromDescription,
  verifySessionForUrl,
} from './server/gemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof GeminiApiError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      retryable: err.retryable,
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR',
    retryable: false,
  });
}

async function createServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/schema', async (req: Request, res: Response) => {
    try {
      const { fieldsText = '', fields = [], mode = 'single' } = req.body ?? {};
      const result = await generateSchemaFromDescription({
        fieldsText: String(fieldsText),
        fields: Array.isArray(fields) ? fields : [],
        mode: mode === 'list' ? 'list' : 'single',
      });
      res.json(result);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/discover', async (req: Request, res: Response) => {
    try {
      const { topic = '', fieldsText = '' } = req.body ?? {};
      const cleanedTopic = String(topic).trim();
      if (!cleanedTopic) {
        res.status(400).json({ error: 'Topic query is required.', code: 'EMPTY_TOPIC', retryable: false });
        return;
      }
      const result = await discoverUrlsForTopic(cleanedTopic, String(fieldsText));
      res.json(result);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/auth/verify-session', async (req: Request, res: Response) => {
    try {
      const { url, sessionAuth } = req.body ?? {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Target URL is required.', code: 'MISSING_URL', retryable: false });
        return;
      }
      if (
        !sessionAuth ||
        (sessionAuth.headerName !== 'Cookie' && sessionAuth.headerName !== 'Authorization') ||
        typeof sessionAuth.headerValue !== 'string' ||
        !sessionAuth.headerValue.trim()
      ) {
        res.status(400).json({ error: 'A valid session header is required.', code: 'MISSING_SESSION', retryable: false });
        return;
      }
      const result = await verifySessionForUrl(url, sessionAuth);
      res.json(result);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/extract', async (req: Request, res: Response) => {
    try {
      const { url, mode, fields, schema, allowSearchFallback = true, sessionAuth = null } = req.body ?? {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Target URL is required.', code: 'MISSING_URL', retryable: false });
        return;
      }
      const validSession =
        sessionAuth &&
        (sessionAuth.headerName === 'Cookie' || sessionAuth.headerName === 'Authorization') &&
        typeof sessionAuth.headerValue === 'string' &&
        sessionAuth.headerValue.trim()
          ? { headerName: sessionAuth.headerName, headerValue: sessionAuth.headerValue.trim() }
          : null;

      const result = await extractFromUrl({
        url,
        mode: mode === 'list' ? 'list' : 'single',
        fields: Array.isArray(fields) ? fields : [],
        schema,
        allowSearchFallback: Boolean(allowSearchFallback),
        sessionAuth: validSession,
      });
      res.json(result);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  if (IS_PROD) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ScrapeSmith server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start ScrapeSmith server:', err);
  process.exit(1);
});
