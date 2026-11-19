import { GoogleGenAI, Type, type Schema } from '@google/genai';
import type {
  CellValue,
  ConfidenceLevel,
  DiscoverUrlsResponse,
  ExtractedRow,
  ExtractionMethod,
  ExtractionMode,
  ExtractUrlRequest,
  ExtractUrlResponse,
  FieldDefinition,
  FieldType,
  GenerateSchemaRequest,
  GenerateSchemaResponse,
  JsonSchema,
  JsonSchemaProperty,
  SessionHeaderPayload,
  VerifySessionResponse,
} from '../src/types/index.ts';
import { checkPiiViolation } from '../src/utils/piiGuard.ts';
import { fieldsToJsonSchema, RESERVED_FIELD_NAMES, slugifyFieldName } from '../src/utils/schemaBuilder.ts';
import { normalizeUrl } from '../src/utils/urlParser.ts';
import {
  buildCleanPageText,
  extractByCssSelectors,
  fetchPageWithSession,
  type PageFetchResult,
} from './htmlExtractor.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const REQUEST_TIMEOUT_MS = 45_000;

export class GeminiApiError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', retryable = false) {
    super(message);
    this.name = 'GeminiApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured. Please add your API key in Settings > Secrets.',
      400,
      'API_KEY_MISSING',
      false
    );
  }
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function classifyGeminiError(err: unknown): GeminiApiError {
  if (err instanceof GeminiApiError) return err;

  const rawMsg = err instanceof Error ? err.message : String(err);
  const lower = rawMsg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return new GeminiApiError(
      'Extraction timed out while waiting for the page or model response. Please retry.',
      504,
      'TIMEOUT',
      true
    );
  }

  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return new GeminiApiError(
      'Gemini API rate limit or quota reached (429). Wait a moment and retry, or check your quota in Settings > Secrets.',
      429,
      'RESOURCE_EXHAUSTED',
      true
    );
  }

  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403') || lower.includes('401')) {
    return new GeminiApiError(
      'Gemini API authentication failed. Please verify your API key in Settings > Secrets.',
      403,
      'API_KEY_INVALID',
      false
    );
  }

  if (lower.includes('not_found') || lower.includes('404')) {
    return new GeminiApiError(
      `Model endpoint returned 404 (${GEMINI_MODEL}). Please retry or verify model availability.`,
      404,
      'NOT_FOUND',
      false
    );
  }

  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded')) {
    return new GeminiApiError(
      'Gemini service is temporarily busy (503). Please retry.',
      503,
      'UNAVAILABLE',
      true
    );
  }

  return new GeminiApiError(rawMsg || 'Unexpected Gemini API error.', 500, 'GEMINI_ERROR', false);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new GeminiApiError(`${label} timed out after ${Math.round(ms / 1000)}s.`, 504, 'TIMEOUT', true));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callWithRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);
      const isTransient = classified.statusCode === 429 || classified.statusCode === 503;
      if (!isTransient || attempt === maxRetries) {
        throw classified;
      }
      const delayMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw classifyGeminiError(lastError);
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function tryParseJson<T>(rawText: string): { ok: true; data: T } | { ok: false; error: string } {
  const cleaned = stripMarkdownFences(rawText);
  try {
    return { ok: true, data: JSON.parse(cleaned) as T };
  } catch (err) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return { ok: true, data: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T };
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Malformed JSON output',
    };
  }
}

function convertPropertyToGeminiSchema(prop: JsonSchemaProperty): Schema {
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  const nullable = prop.nullable === true || types.includes('null');
  const primary = types.find((t) => t !== 'null') ?? 'string';

  const base: Schema = {
    type: Type.STRING,
    ...(prop.description ? { description: prop.description } : {}),
    ...(nullable ? { nullable: true } : {}),
  };

  if (primary === 'number') {
    base.type = Type.NUMBER;
  } else if (primary === 'boolean') {
    base.type = Type.BOOLEAN;
  } else if (primary === 'array') {
    base.type = Type.ARRAY;
    base.items = prop.items ? convertPropertyToGeminiSchema(prop.items) : { type: Type.STRING };
  } else if (primary === 'object' && prop.properties && Object.keys(prop.properties).length > 0) {
    base.type = Type.OBJECT;
    const childProps: Record<string, Schema> = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      childProps[k] = convertPropertyToGeminiSchema(v);
    }
    base.properties = childProps;
    if (prop.required && prop.required.length > 0) {
      base.required = prop.required.filter((k) => k in childProps);
    }
  } else {
    base.type = Type.STRING;
    if (prop.enum && prop.enum.length > 0) {
      base.enum = prop.enum;
    }
  }

  return base;
}

function convertJsonSchemaToGeminiSchema(schema: JsonSchema): Schema {
  const properties: Record<string, Schema> = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    properties[k] = convertPropertyToGeminiSchema(v);
  }
  const required = (schema.required ?? []).filter((k) => k in properties);
  return {
    type: Type.OBJECT,
    ...(schema.description ? { description: schema.description } : {}),
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

async function repairJsonWithModel<T>(
  rawMalformedText: string,
  targetSchema: Schema,
  parseError: string
): Promise<T> {
  const ai = getClient();
  const repairPrompt = [
    'You are a strict JSON repair assistant.',
    'Convert the malformed output below into valid JSON that strictly conforms to the provided responseSchema.',
    'Rules: Do NOT invent any new facts or values that are not present in the original text. Set missing values to null.',
    `Parse error: ${parseError}`,
    '',
    'Malformed output:',
    rawMalformedText.slice(0, 12_000),
  ].join('\n');

  const response = await callWithRateLimitRetry(() =>
    withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: repairPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: targetSchema,
        },
      }),
      REQUEST_TIMEOUT_MS,
      'JSON repair'
    )
  );

  const repairedText = response.text ?? '';
  const parsed = tryParseJson<T>(repairedText);
  if (!parsed.ok) {
    throw new GeminiApiError(
      `Model returned malformed JSON even after repair retry (${parsed.error}).`,
      502,
      'MALFORMED_OUTPUT',
      true
    );
  }
  return parsed.data;
}

const VALID_FIELD_TYPES = new Set<FieldType>(['string', 'number', 'boolean', 'url', 'date', 'list']);

export async function generateSchemaFromDescription(
  req: GenerateSchemaRequest
): Promise<GenerateSchemaResponse> {
  const pii = checkPiiViolation(req.fieldsText, req.fields);
  if (pii.blocked) {
    throw new GeminiApiError(pii.message, 400, 'PII_REFUSED', false);
  }

  const ai = getClient();
  const schemaDefResponseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      fields: {
        type: Type.ARRAY,
        description: 'Clean normalized field definitions derived from the user request.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'snake_case field identifier (lowercase alphanumeric and underscores only).',
            },
            type: {
              type: Type.STRING,
              enum: ['string', 'number', 'boolean', 'url', 'date', 'list'],
              description: 'Best matching data type for this field.',
            },
            description: {
              type: Type.STRING,
              description: 'Concise extraction guidance for what to read from the page.',
            },
          },
          required: ['name', 'type', 'description'],
        },
      },
    },
    required: ['fields'],
  };

  const prompt = [
    'Convert the user field specification into clean, structured extraction field definitions.',
    `Extraction mode: ${req.mode === 'list' ? 'List of items per page' : 'Single item per page'}`,
    req.fieldsText ? `User free-text description: ${req.fieldsText}` : '',
    req.fields.length > 0
      ? `Existing structured fields: ${JSON.stringify(req.fields.map((f) => ({ name: f.name, type: f.type, description: f.description })))}`
      : '',
    'Rules:',
    '- Use concise snake_case names.',
    '- Do NOT include reserved fields (confidence, source_snippet, notes, source_url) — those are added automatically.',
    '- Do NOT include private personal data fields (personal emails, phone numbers, home addresses).',
    '- Choose accurate types: price/rating/count -> number, links/images -> url, dates -> date, tags/features -> list, yes/no flags -> boolean.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await callWithRateLimitRetry(() =>
    withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are ScrapeSmith Schema Architect. Return only valid JSON matching the responseSchema.',
          responseMimeType: 'application/json',
          responseSchema: schemaDefResponseSchema,
        },
      }),
      REQUEST_TIMEOUT_MS,
      'Schema generation'
    )
  );

  const rawText = response.text ?? '';
  let parsed = tryParseJson<{ fields: Array<{ name: string; type: string; description?: string }> }>(rawText);
  let repaired = false;

  if (!parsed.ok) {
    const repairedData = await repairJsonWithModel<{
      fields: Array<{ name: string; type: string; description?: string }>;
    }>(rawText, schemaDefResponseSchema, parsed.error);
    parsed = { ok: true, data: repairedData };
    repaired = true;
  }

  const existingRuleMap = new Map(req.fields.map((f) => [f.name, f.rules]));
  const seen = new Set<string>();
  const normalizedFields: FieldDefinition[] = [];

  for (const item of parsed.data.fields ?? []) {
    const name = slugifyFieldName(item.name || '');
    if (!name || RESERVED_FIELD_NAMES.has(name) || seen.has(name)) continue;
    const type: FieldType = VALID_FIELD_TYPES.has(item.type as FieldType)
      ? (item.type as FieldType)
      : 'string';
    seen.add(name);
    normalizedFields.push({
      id: `field_${name}`,
      name,
      type,
      description: item.description?.trim() || name.replace(/_/g, ' '),
      ...(existingRuleMap.get(name) ? { rules: existingRuleMap.get(name) } : {}),
    });
  }

  if (normalizedFields.length === 0) {
    throw new GeminiApiError(
      'Could not derive any valid fields from your description. Please list at least one field name.',
      400,
      'EMPTY_FIELDS',
      false
    );
  }

  const postPii = checkPiiViolation('', normalizedFields);
  if (postPii.blocked) {
    throw new GeminiApiError(postPii.message, 400, 'PII_REFUSED', false);
  }

  const schema = fieldsToJsonSchema(normalizedFields, req.mode);
  return {
    schema,
    fields: normalizedFields,
    repaired,
  };
}

export async function discoverUrlsForTopic(
  topic: string,
  fieldsText = ''
): Promise<DiscoverUrlsResponse> {
  const ai = getClient();

  const prompt = [
    `Find 3 to 5 reputable, publicly accessible web pages (no login walls or paywalls) for this topic: "${topic}".`,
    fieldsText ? `The pages should visibly contain data relevant to these fields: ${fieldsText}.` : '',
    'Return a JSON object with a "pages" array containing { "url": "https://...", "title": "Page Title" }.',
    'Only include real URLs returned by Google Search.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await callWithRateLimitRetry(() =>
    withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      }),
      REQUEST_TIMEOUT_MS,
      'Topic URL discovery'
    )
  );

  const collected = new Map<string, string>();

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    const title = chunk.web?.title;
    if (uri) {
      const normalized = normalizeUrl(uri);
      if (normalized && !collected.has(normalized.toLowerCase())) {
        collected.set(normalized.toLowerCase(), title?.trim() || normalized);
      }
    }
  }

  const text = response.text ?? '';
  const parsed = tryParseJson<{ pages?: Array<{ url?: string; title?: string }> }>(text);
  if (parsed.ok && Array.isArray(parsed.data.pages)) {
    for (const page of parsed.data.pages) {
      if (!page.url) continue;
      const normalized = normalizeUrl(page.url);
      if (normalized && !collected.has(normalized.toLowerCase())) {
        collected.set(normalized.toLowerCase(), page.title?.trim() || normalized);
      }
    }
  }

  if (collected.size === 0) {
    const urlMatches = text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
    for (const match of urlMatches) {
      const cleaned = match.replace(/[.,;:]+$/, '');
      const normalized = normalizeUrl(cleaned);
      if (normalized && !collected.has(normalized.toLowerCase())) {
        collected.set(normalized.toLowerCase(), normalized);
      }
    }
  }

  const urls = Array.from(collected.entries())
    .slice(0, 5)
    .map(([urlKey, title]) => ({
      url: normalizeUrl(urlKey) ?? urlKey,
      title,
    }));

  if (urls.length === 0) {
    throw new GeminiApiError(
      'Google Search did not return any public pages for that topic. Try a more specific query or paste URLs directly.',
      404,
      'NO_URLS_FOUND',
      false
    );
  }

  return { urls };
}

export async function verifySessionForUrl(
  rawUrl: string,
  sessionAuth: SessionHeaderPayload
): Promise<VerifySessionResponse> {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (!normalizedUrl) {
    throw new GeminiApiError('Invalid or disallowed URL provided.', 400, 'INVALID_URL', false);
  }

  try {
    const res = await fetchPageWithSession(normalizedUrl, {
      sessionAuth,
      timeoutMs: 15_000,
    });

    if (res.authRequired) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.finalUrl,
        loginDetected: true,
        message: res.authHint ?? `Authentication still required (HTTP ${res.status}).`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.finalUrl,
        loginDetected: false,
        message: `Target responded with HTTP ${res.status}.`,
      };
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: res.finalUrl,
      loginDetected: false,
      message: `Session verified (HTTP ${res.status}). Ready to extract.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach target URL.';
    return {
      ok: false,
      status: 0,
      finalUrl: normalizedUrl,
      loginDetected: false,
      message: `Verification request failed: ${msg}`,
    };
  }
}

function normalizeConfidence(raw: unknown): ConfidenceLevel {
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (lower === 'high' || lower === 'medium' || lower === 'low') {
      return lower;
    }
  }
  return 'medium';
}

function normalizeRowValue(raw: unknown, type: FieldType): CellValue {
  if (raw === null || raw === undefined) return null;

  if (type === 'list') {
    if (Array.isArray(raw)) {
      const cleaned = raw.map((v) => String(v ?? '').trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : null;
    }
    const str = String(raw).trim();
    return str ? [str] : null;
  }

  if (type === 'number') {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const str = String(raw).trim().replace(/[$,%\s,]/g, '');
    if (!str) return null;
    const num = Number(str);
    return Number.isFinite(num) ? num : null;
  }

  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const lower = String(raw).trim().toLowerCase();
    if (['true', 'yes', '1'].includes(lower)) return true;
    if (['false', 'no', '0'].includes(lower)) return false;
    return null;
  }

  const str = String(raw).trim();
  return str === '' || str.toLowerCase() === 'null' ? null : str;
}

function buildRowsFromModelPayload(
  payload: Record<string, unknown>,
  url: string,
  fields: FieldDefinition[],
  mode: ExtractionMode
): { rows: ExtractedRow[]; failedReason: string | null } {
  const failedReason =
    typeof payload.failed_reason === 'string' && payload.failed_reason.trim().length > 0
      ? payload.failed_reason.trim()
      : null;

  let rawItems: Array<Record<string, unknown>> = [];

  if (mode === 'list') {
    if (Array.isArray(payload.items)) {
      rawItems = payload.items.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
      );
    } else if (Array.isArray(payload.rows)) {
      rawItems = payload.rows.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
      );
    }
  } else {
    if (payload.item && typeof payload.item === 'object' && !Array.isArray(payload.item)) {
      rawItems = [payload.item as Record<string, unknown>];
    } else if (Array.isArray(payload.items) && payload.items[0] && typeof payload.items[0] === 'object') {
      rawItems = [payload.items[0] as Record<string, unknown>];
    } else if (!('item' in payload) && !('items' in payload)) {
      const hasAnyField = fields.some((f) => f.name in payload);
      if (hasAnyField) {
        rawItems = [payload];
      }
    }
  }

  const rows: ExtractedRow[] = [];
  const seenFingerprints = new Set<string>();

  for (let i = 0; i < rawItems.length; i += 1) {
    const raw = rawItems[i];
    const values: Record<string, CellValue> = {};
    let hasAtLeastOneNonNull = false;

    for (const field of fields) {
      const normalized = normalizeRowValue(raw[field.name], field.type);
      values[field.name] = normalized;
      if (normalized !== null) {
        hasAtLeastOneNonNull = true;
      }
    }

    if (!hasAtLeastOneNonNull) continue;

    const fingerprint = JSON.stringify(values);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const snippetRaw = typeof raw.source_snippet === 'string' ? raw.source_snippet.trim() : '';
    const notesRaw = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null;

    rows.push({
      _id: `${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      _sourceUrl: url,
      confidence: normalizeConfidence(raw.confidence),
      source_snippet: snippetRaw || 'Extracted from visible page text.',
      notes: notesRaw,
      values,
    });
  }

  return { rows, failedReason };
}

function isAuthOrLoginReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /(login|sign\s*in|authentication|session expired|unauthorized|401|403 forbidden|members only|requires account)/i.test(
    reason
  );
}

function isPaywallReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /(paywall|subscription required|paid subscribers|blocked by robots)/i.test(reason);
}

function checkUrlContextRetrievalFailure(response: unknown): string | null {
  const candidates = (response as { candidates?: Array<{ urlContextMetadata?: { urlMetadata?: Array<{ retrievedUrl?: string; urlRetrievalStatus?: string }> } }> })?.candidates;
  const metaList = candidates?.[0]?.urlContextMetadata?.urlMetadata;
  if (!Array.isArray(metaList) || metaList.length === 0) return null;

  for (const meta of metaList) {
    const status = String(meta.urlRetrievalStatus ?? '');
    if (status && status !== 'URL_RETRIEVAL_STATUS_SUCCESS' && status !== 'URL_RETRIEVAL_STATUS_UNSPECIFIED') {
      return status;
    }
  }
  return null;
}

const EXTRACTION_SYSTEM_INSTRUCTION = [
  'You are ScrapeSmith, a precise web data extraction engine.',
  'STRICT EXTRACTION RULES:',
  '- Extract ONLY what is visibly stated on the page. If a field is missing or not stated, return null. NEVER invent, guess, or extrapolate values.',
  '- For every extracted row, include source_snippet: a short exact fragment (under 180 chars) quoted verbatim from the page proving the extracted values.',
  '- Set confidence: "high" = stated explicitly, "medium" = needed light interpretation, "low" = ambiguous.',
  '- Normalize: prices as pure numbers (note currency code like USD/GBP/EUR in notes), dates as ISO 8601 (YYYY-MM-DD), strip extra whitespace, dedupe identical rows.',
  '- When expanded HTML tables (with merged colspan/rowspan cells flattened) are supplied, read every normalized row accurately without losing merged parent labels.',
  '- When CSS selector matches are supplied for specific fields, prioritize those exact matched values unless empty.',
  '- If the page fails to load, returns an error, or requires login/authentication or is behind a paywall, do NOT bypass it: set failed_reason explaining why, and return item: null or items: [].',
  '- PRIVACY: Never extract personal data of private individuals (personal emails, phone numbers, home addresses). Return null for any personal private data.',
  '- Return ONLY valid JSON conforming strictly to the responseSchema.',
].join('\n');

function describeFieldWithRules(f: FieldDefinition): string {
  const parts = [`- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ''}`];
  const r = f.rules;
  if (r) {
    const hints: string[] = [];
    if (r.cssSelector) {
      hints.push(`CSS selector="${r.cssSelector}"${r.attribute && r.attribute !== 'text' ? ` attr="${r.attribute}"` : ''}`);
    }
    if (r.expandMergedCells) {
      hints.push('expand merged HTML table cells (colspan/rowspan)');
    }
    if (r.waitForDynamic) {
      hints.push(`dynamic JS content${r.dynamicWaitMs ? ` (wait ${r.dynamicWaitMs}ms)` : ''}`);
    }
    if (hints.length > 0) {
      parts.push(`  [Advanced rules: ${hints.join('; ')}]`);
    }
  }
  return parts.join('\n');
}

async function extractFromFetchedDomWithGemini(
  url: string,
  fetched: PageFetchResult,
  mode: ExtractionMode,
  fields: FieldDefinition[],
  geminiSchema: Schema,
  cssHintRows: ExtractedRow[]
): Promise<{ payload: Record<string, unknown>; repaired: boolean }> {
  const ai = getClient();
  const fieldSummary = fields.map(describeFieldWithRules).join('\n');

  const sections: string[] = [
    `Extract structured data from the fetched page content for: ${url}`,
    `Extraction mode: ${mode === 'list' ? 'Extract ALL matching items visibly present (up to 35 items).' : 'Extract a SINGLE primary record.'}`,
    'Fields to extract:',
    fieldSummary,
  ];

  if (cssHintRows.length > 0) {
    sections.push(
      '\n--- DETERMINISTIC CSS SELECTOR MATCHES (use these exact values for matched fields) ---',
      JSON.stringify(cssHintRows.map((r) => r.values).slice(0, 35))
    );
  }

  if (fetched.expandedTables.length > 0) {
    const tableBlock = fetched.expandedTables
      .slice(0, 6)
      .map(
        (t) =>
          `[Table #${t.index + 1}${t.mergedCellCount > 0 ? ` (${t.mergedCellCount} merged colspan/rowspan cells expanded)` : ''}]\n${t.markdown}`
      )
      .join('\n\n')
      .slice(0, 18_000);
    sections.push('\n--- EXPANDED HTML TABLES (colspan/rowspan resolved) ---', tableBlock);
  }

  if (fetched.hydrationPayloads.length > 0) {
    sections.push(
      '\n--- EMBEDDED HYDRATION / JSON-LD PAYLOADS (dynamic client data) ---',
      fetched.hydrationPayloads.join('\n').slice(0, 14_000)
    );
  }

  sections.push('\n--- VISIBLE PAGE TEXT ---', buildCleanPageText(fetched.html).slice(0, 16_000));

  const response = await callWithRateLimitRetry(() =>
    withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: sections.join('\n'),
        config: {
          systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: geminiSchema,
        },
      }),
      REQUEST_TIMEOUT_MS,
      'DOM structured extraction'
    )
  );

  const rawText = response.text ?? '';
  const parsed = tryParseJson<Record<string, unknown>>(rawText);
  if (parsed.ok) {
    return { payload: parsed.data, repaired: false };
  }

  const repairedPayload = await repairJsonWithModel<Record<string, unknown>>(
    rawText,
    geminiSchema,
    parsed.error
  );
  return { payload: repairedPayload, repaired: true };
}

async function executeExtractionPass(
  url: string,
  mode: ExtractionMode,
  fields: FieldDefinition[],
  geminiSchema: Schema,
  method: 'url_context' | 'google_search'
): Promise<{
  payload: Record<string, unknown>;
  repaired: boolean;
  retrievalFailureStatus: string | null;
}> {
  const ai = getClient();
  const fieldSummary = fields.map(describeFieldWithRules).join('\n');

  const prompt =
    method === 'url_context'
      ? [
          `Read the web page at: ${url}`,
          `Extraction mode: ${mode === 'list' ? 'Extract ALL matching items visibly listed on the page (up to 30 items).' : 'Extract a SINGLE primary record for this page.'}`,
          'Fields to extract:',
          fieldSummary,
          'Return valid JSON matching the schema.',
        ].join('\n')
      : [
          `Use Google Search to inspect publicly indexed information specifically about this URL/page: ${url}`,
          `Extraction mode: ${mode === 'list' ? 'Extract visible matching items from this page.' : 'Extract the single primary record for this page.'}`,
          'Fields to extract:',
          fieldSummary,
          'Only report facts grounded in search results for this page; return null for any missing field and never guess.',
          'Return valid JSON matching the schema.',
        ].join('\n');

  const tools = method === 'url_context' ? [{ urlContext: {} }] : [{ googleSearch: {} }];

  let rawText = '';
  let retrievalFailureStatus: string | null = null;

  try {
    const response = await callWithRateLimitRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
            tools,
            responseMimeType: 'application/json',
            responseSchema: geminiSchema,
          },
        }),
        REQUEST_TIMEOUT_MS,
        `Extraction (${method})`
      )
    );
    rawText = response.text ?? '';
    if (method === 'url_context') {
      retrievalFailureStatus = checkUrlContextRetrievalFailure(response);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/(400|invalid_argument|response_mime_type|response_schema|controlled generation)/i.test(msg)) {
      const readResponse = await callWithRateLimitRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: `${prompt}\n\nRespond ONLY with raw JSON matching the required fields (including confidence, source_snippet, notes, and failed_reason).`,
            config: {
              systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
              tools,
            },
          }),
          REQUEST_TIMEOUT_MS,
          `Extraction read (${method})`
        )
      );
      if (method === 'url_context') {
        retrievalFailureStatus = checkUrlContextRetrievalFailure(readResponse);
      }
      const unformatted = readResponse.text ?? '';
      const structured = await callWithRateLimitRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: `Format the following extracted page data strictly into the responseSchema JSON without inventing any new facts:\n\n${unformatted}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: geminiSchema,
            },
          }),
          REQUEST_TIMEOUT_MS,
          'Extraction schema formatting'
        )
      );
      rawText = structured.text ?? '';
    } else {
      throw classifyGeminiError(err);
    }
  }

  const parsed = tryParseJson<Record<string, unknown>>(rawText);
  if (parsed.ok) {
    return { payload: parsed.data, repaired: false, retrievalFailureStatus };
  }

  const repairedPayload = await repairJsonWithModel<Record<string, unknown>>(
    rawText,
    geminiSchema,
    parsed.error
  );
  return { payload: repairedPayload, repaired: true, retrievalFailureStatus };
}

export async function extractFromUrl(req: ExtractUrlRequest): Promise<ExtractUrlResponse> {
  const normalizedUrl = normalizeUrl(req.url);
  if (!normalizedUrl) {
    throw new GeminiApiError('Invalid or disallowed URL provided.', 400, 'INVALID_URL', false);
  }

  const pii = checkPiiViolation('', req.fields, JSON.stringify(req.schema));
  if (pii.blocked) {
    throw new GeminiApiError(pii.message, 400, 'PII_REFUSED', false);
  }

  if (!req.fields || req.fields.length === 0) {
    throw new GeminiApiError('At least one extraction field is required.', 400, 'EMPTY_FIELDS', false);
  }

  const geminiSchema = convertJsonSchemaToGeminiSchema(req.schema);
  const allowFallback = req.allowSearchFallback !== false;

  const hasSessionAuth = Boolean(req.sessionAuth?.headerValue);
  const hasCssSelectors = req.fields.some((f) => Boolean(f.rules?.cssSelector?.trim()));
  const wantsMergedTables = req.fields.some((f) => Boolean(f.rules?.expandMergedCells));
  const wantsDynamic = req.fields.some((f) => Boolean(f.rules?.waitForDynamic));
  const needsDomPipeline = hasSessionAuth || hasCssSelectors || wantsMergedTables;

  // Path A: Direct authenticated fetch and/or deterministic DOM rules (CSS overrides + merged table expansion)
  if (needsDomPipeline) {
    try {
      const fetched = await fetchPageWithSession(normalizedUrl, {
        sessionAuth: req.sessionAuth,
        timeoutMs: 20_000,
      });

      if (fetched.authRequired) {
        return {
          url: normalizedUrl,
          method: hasSessionAuth ? 'authenticated_fetch' : 'dom_rules',
          rows: [],
          failedReason: fetched.authHint ?? `Authentication required (HTTP ${fetched.status}).`,
          authRequired: true,
          authHint: fetched.authHint,
        };
      }

      if (fetched.ok && (!fetched.isLikelySpaShell || hasSessionAuth || fetched.hydrationPayloads.length > 0)) {
        const cssResult = hasCssSelectors
          ? extractByCssSelectors(fetched.html, normalizedUrl, req.fields, req.mode)
          : { rows: [], matchedFields: [], unmatchedFields: req.fields.map((f) => f.name) };

        const allMatchedByCss =
          hasCssSelectors &&
          cssResult.rows.length > 0 &&
          (cssResult.unmatchedFields.length === 0 ||
            req.fields
              .filter((f) => cssResult.unmatchedFields.includes(f.name))
              .every((f) => f.rules?.fallbackToAi === false));

        if (allMatchedByCss) {
          return {
            url: normalizedUrl,
            method: hasSessionAuth ? 'authenticated_fetch' : 'dom_rules',
            rows: cssResult.rows,
            failedReason: null,
          };
        }

        // Hybrid pass: feed expanded colspan/rowspan tables + CSS hints + hydration JSON + page text into Gemini
        const domAi = await extractFromFetchedDomWithGemini(
          normalizedUrl,
          fetched,
          req.mode,
          req.fields,
          geminiSchema,
          cssResult.rows
        );
        const built = buildRowsFromModelPayload(domAi.payload, normalizedUrl, req.fields, req.mode);

        if (built.rows.length > 0) {
          return {
            url: normalizedUrl,
            method: hasSessionAuth ? 'authenticated_fetch' : 'dom_rules',
            rows: built.rows,
            failedReason: null,
            repaired: domAi.repaired,
          };
        }

        if (hasSessionAuth) {
          return {
            url: normalizedUrl,
            method: 'authenticated_fetch',
            rows: [],
            failedReason: built.failedReason ?? 'Authenticated page loaded, but no matching fields were found.',
            authRequired: isAuthOrLoginReason(built.failedReason),
            authHint: isAuthOrLoginReason(built.failedReason) ? built.failedReason : null,
            repaired: domAi.repaired,
          };
        }
      }
      // If page is a dynamic JS SPA shell or static fetch returned non-OK without auth, fall through to URL Context
    } catch (err) {
      if (hasSessionAuth) {
        const msg = err instanceof Error ? err.message : 'Authenticated fetch failed.';
        return {
          url: normalizedUrl,
          method: 'authenticated_fetch',
          rows: [],
          failedReason: msg,
          authRequired: /(401|403|auth|login)/i.test(msg),
        };
      }
      // Non-auth DOM fetch failed (e.g. bot wall or dynamic SPA) — fall through to Gemini URL Context
    }
  }

  // Path B: Primary Gemini URL Context tool (also renders dynamic JS pages cleanly)
  let urlContextError: string | null = null;
  try {
    const primary = await executeExtractionPass(
      normalizedUrl,
      req.mode,
      req.fields,
      geminiSchema,
      'url_context'
    );

    const { rows, failedReason } = buildRowsFromModelPayload(
      primary.payload,
      normalizedUrl,
      req.fields,
      req.mode
    );

    if (isAuthOrLoginReason(failedReason)) {
      return {
        url: normalizedUrl,
        method: 'url_context',
        rows: [],
        failedReason: failedReason ?? 'Page requires login or session re-authentication.',
        authRequired: true,
        authHint: failedReason,
        repaired: primary.repaired,
      };
    }

    if (isPaywallReason(failedReason)) {
      return {
        url: normalizedUrl,
        method: 'url_context',
        rows: [],
        failedReason: failedReason ?? 'Page is behind a paywall or restricted by robots.txt.',
        authRequired: false,
        repaired: primary.repaired,
      };
    }

    if (rows.length > 0) {
      return {
        url: normalizedUrl,
        method: wantsDynamic ? 'url_context' : 'url_context',
        rows,
        failedReason: null,
        repaired: primary.repaired,
      };
    }

    urlContextError =
      failedReason ??
      (primary.retrievalFailureStatus
        ? `URL Context retrieval status: ${primary.retrievalFailureStatus}`
        : 'No matching fields found directly via URL Context.');

    if (!allowFallback) {
      return {
        url: normalizedUrl,
        method: 'url_context',
        rows: [],
        failedReason: urlContextError,
        repaired: primary.repaired,
      };
    }
  } catch (err) {
    const classified = classifyGeminiError(err);
    if (
      classified.code === 'API_KEY_MISSING' ||
      classified.code === 'API_KEY_INVALID' ||
      classified.code === 'PII_REFUSED' ||
      classified.code === 'RESOURCE_EXHAUSTED'
    ) {
      throw classified;
    }
    urlContextError = classified.message;
    if (!allowFallback) {
      throw classified;
    }
  }

  // Path C: Google Search grounding fallback
  const fallback = await executeExtractionPass(
    normalizedUrl,
    req.mode,
    req.fields,
    geminiSchema,
    'google_search'
  );

  const fallbackBuilt = buildRowsFromModelPayload(
    fallback.payload,
    normalizedUrl,
    req.fields,
    req.mode
  );

  if (fallbackBuilt.rows.length > 0) {
    return {
      url: normalizedUrl,
      method: 'google_search',
      rows: fallbackBuilt.rows,
      failedReason: null,
      repaired: fallback.repaired,
    };
  }

  const finalReason =
    fallbackBuilt.failedReason ??
    urlContextError ??
    'Could not extract requested fields from this page.';

  return {
    url: normalizedUrl,
    method: 'google_search',
    rows: [],
    failedReason: finalReason,
    authRequired: isAuthOrLoginReason(finalReason),
    authHint: isAuthOrLoginReason(finalReason) ? finalReason : null,
    repaired: fallback.repaired,
  };
}
