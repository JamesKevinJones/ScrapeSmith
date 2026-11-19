import * as cheerio from 'cheerio';
import type {
  CellValue,
  ExtractedRow,
  ExtractionMode,
  FieldDefinition,
  FieldType,
  SessionHeaderPayload,
} from '../src/types/index.ts';

export interface ExpandedHtmlTable {
  index: number;
  caption: string | null;
  headers: string[];
  rows: string[][];
  mergedCellCount: number;
  markdown: string;
}

export interface CssExtractionResult {
  rows: ExtractedRow[];
  matchedFields: string[];
  unmatchedFields: string[];
}

export interface PageFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  authRequired: boolean;
  authHint: string | null;
  contentType: string;
  hydrationPayloads: string[];
  expandedTables: ExpandedHtmlTable[];
  isLikelySpaShell: boolean;
}

/**
 * Expands every HTML <table> containing merged cells (colspan / rowspan) into a
 * lossless rectangular 2D grid so downstream extraction never misaligns columns.
 */
export function expandHtmlTables(html: string): ExpandedHtmlTable[] {
  const $ = cheerio.load(html);
  const tables: ExpandedHtmlTable[] = [];

  $('table').each((tableIdx, tableEl) => {
    const captionText = $(tableEl).find('> caption').first().text().trim() || null;
    const grid: string[][] = [];
    let mergedCellCount = 0;

    // Collect direct table rows (thead, tbody, tfoot, or direct tr) while avoiding nested table rows
    const rowElements = $(tableEl)
      .find('tr')
      .filter((_idx, tr) => $(tr).closest('table')[0] === tableEl);

    rowElements.each((rowIdx, tr) => {
      if (!grid[rowIdx]) grid[rowIdx] = [];
      let colIdx = 0;

      const cells = $(tr)
        .children('th, td')
        .filter((_i, cell) => $(cell).closest('tr')[0] === tr);

      cells.each((_cIdx, cell) => {
        while (grid[rowIdx][colIdx] !== undefined) {
          colIdx += 1;
        }

        const rawColspan = Number.parseInt($(cell).attr('colspan') ?? '1', 10);
        const rawRowspan = Number.parseInt($(cell).attr('rowspan') ?? '1', 10);
        const colspan = Number.isFinite(rawColspan) && rawColspan > 0 ? Math.min(rawColspan, 50) : 1;
        const rowspan = Number.isFinite(rawRowspan) && rawRowspan > 0 ? Math.min(rawRowspan, 100) : 1;

        if (colspan > 1 || rowspan > 1) {
          mergedCellCount += 1;
        }

        const cellText = $(cell).text().replace(/\s+/g, ' ').trim();

        for (let r = 0; r < rowspan; r += 1) {
          const targetRow = rowIdx + r;
          if (!grid[targetRow]) grid[targetRow] = [];
          for (let c = 0; c < colspan; c += 1) {
            grid[targetRow][colIdx + c] = cellText;
          }
        }

        colIdx += colspan;
      });
    });

    if (grid.length === 0) return;

    const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    if (maxCols === 0) return;

    const normalizedGrid = grid.map((row) =>
      Array.from({ length: maxCols }, (_, i) => (row[i] ?? '').trim())
    );

    const headers = normalizedGrid[0];
    const dataRows = normalizedGrid.slice(1);

    const headerLine = `| ${headers.map((h) => h.replace(/\|/g, '\\|')).join(' | ')} |`;
    const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const bodyLines = dataRows.map(
      (r) => `| ${r.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
    );

    tables.push({
      index: tableIdx,
      caption: captionText,
      headers,
      rows: normalizedGrid,
      mergedCellCount,
      markdown: [captionText ? `Table: ${captionText}` : null, headerLine, sepLine, ...bodyLines]
        .filter(Boolean)
        .join('\n'),
    });
  });

  return tables;
}

/**
 * Extracts embedded JSON-LD, Next.js __NEXT_DATA__, Nuxt state, or hydration JSON scripts
 * used by dynamically rendered JavaScript apps.
 */
export function extractHydrationData(html: string): string[] {
  const $ = cheerio.load(html);
  const payloads: string[] = [];

  $('script[type="application/ld+json"], script#__NEXT_DATA__, script[type="application/json"]').each(
    (_i, el) => {
      const content = $(el).html()?.trim();
      if (content && content.length > 2 && content.length <= 40_000) {
        payloads.push(content);
      }
    }
  );

  return payloads.slice(0, 6);
}

function coerceSelectorValue(raw: string | null | undefined, type: FieldType, baseUrl: string): CellValue {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  switch (type) {
    case 'number': {
      const match = trimmed.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
      if (!match) return null;
      const num = Number(match[0]);
      return Number.isFinite(num) ? num : null;
    }
    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (/(true|yes|in stock|available|active|enabled)/i.test(lower)) return true;
      if (/(false|no|out of stock|unavailable|sold out|disabled)/i.test(lower)) return false;
      return null;
    }
    case 'url': {
      try {
        return new URL(trimmed, baseUrl).toString();
      } catch {
        return trimmed;
      }
    }
    case 'list': {
      const items = trimmed
        .split(/[,;|•]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return items.length > 0 ? items : null;
    }
    case 'date':
    case 'string':
    default:
      return trimmed;
  }
}

function readElementValue(
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<any>,
  attribute?: string
): string {
  const attr = attribute?.trim();
  if (!attr || attr === 'text') {
    return el.text().replace(/\s+/g, ' ').trim();
  }
  return (el.attr(attr) ?? '').trim();
}

/**
 * Deterministic per-field CSS selector extraction supporting both single and list modes.
 */
export function extractByCssSelectors(
  html: string,
  url: string,
  fields: FieldDefinition[],
  mode: ExtractionMode
): CssExtractionResult {
  const selectorFields = fields.filter((f) => f.rules?.cssSelector?.trim());
  if (selectorFields.length === 0) {
    return { rows: [], matchedFields: [], unmatchedFields: fields.map((f) => f.name) };
  }

  const $ = cheerio.load(html);
  const perFieldMatches = new Map<string, Array<{ raw: string; value: CellValue }>>();
  const matchedFields: string[] = [];
  const unmatchedFields: string[] = [];

  for (const field of fields) {
    const selector = field.rules?.cssSelector?.trim();
    if (!selector) {
      unmatchedFields.push(field.name);
      continue;
    }

    try {
      const nodes = $(selector);
      const extracted: Array<{ raw: string; value: CellValue }> = [];
      nodes.each((_idx, node) => {
        const raw = readElementValue($, $(node), field.rules?.attribute);
        if (raw) {
          extracted.push({
            raw,
            value: coerceSelectorValue(raw, field.type, url),
          });
        }
      });

      if (extracted.length > 0) {
        perFieldMatches.set(field.name, extracted);
        matchedFields.push(field.name);
      } else {
        unmatchedFields.push(field.name);
      }
    } catch {
      unmatchedFields.push(field.name);
    }
  }

  if (matchedFields.length === 0) {
    return { rows: [], matchedFields, unmatchedFields };
  }

  const maxRows =
    mode === 'single'
      ? 1
      : Math.min(
          50,
          Array.from(perFieldMatches.values()).reduce((max, arr) => Math.max(max, arr.length), 0)
        );

  const rows: ExtractedRow[] = [];

  for (let i = 0; i < maxRows; i += 1) {
    const values: Record<string, CellValue> = {};
    const snippets: string[] = [];
    let hasValue = false;

    for (const field of fields) {
      const matches = perFieldMatches.get(field.name);
      if (matches && matches[i]) {
        values[field.name] = matches[i].value;
        if (matches[i].value !== null) hasValue = true;
        if (snippets.length < 3) {
          snippets.push(matches[i].raw.slice(0, 70));
        }
      } else {
        values[field.name] = null;
      }
    }

    if (!hasValue) continue;

    rows.push({
      _id: `css_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      _sourceUrl: url,
      confidence: 'high',
      source_snippet: snippets.join(' | ').slice(0, 180) || 'Matched via CSS selector override.',
      notes: 'Extracted using per-field CSS selector rules.',
      values,
    });
  }

  return { rows, matchedFields, unmatchedFields };
}

function detectLoginWallInHtml(status: number, originalUrl: string, finalUrl: string, html: string): {
  authRequired: boolean;
  authHint: string | null;
} {
  if (status === 401 || status === 403) {
    return {
      authRequired: true,
      authHint: `Target returned HTTP ${status}. Provide a valid temporary session cookie or authorization token to access this page.`,
    };
  }

  const lowerFinal = finalUrl.toLowerCase();
  const lowerOrig = originalUrl.toLowerCase();
  const redirectedToLogin =
    !/(login|signin|sign-in|auth|sso)/i.test(lowerOrig) &&
    /(\/login|\/signin|\/sign-in|\/auth|\/sso|\/account\/login)/i.test(lowerFinal);

  if (redirectedToLogin) {
    return {
      authRequired: true,
      authHint: `Redirected to login page (${finalUrl}). Trigger manual re-login or attach a refreshed session cookie.`,
    };
  }

  const $ = cheerio.load(html);
  const hasPasswordInput = $('input[type="password"]').length > 0;
  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const shortLoginPrompt =
    hasPasswordInput &&
    visibleText.length < 2500 &&
    /(sign in|log in|enter your password|session expired|authentication required)/i.test(visibleText);

  if (shortLoginPrompt) {
    return {
      authRequired: true,
      authHint: 'Page presents a login form or session-expired prompt. Re-authenticate to continue.',
    };
  }

  return { authRequired: false, authHint: null };
}

function detectSpaShell(html: string): boolean {
  const $ = cheerio.load(html);
  const bodyText = $('body').clone().find('script, style, noscript').remove().end().text().replace(/\s+/g, ' ').trim();
  const hasAppRoot = $('#root, #app, #__next, #__nuxt, [data-reactroot]').length > 0;
  const hasJsNotice = /(enable javascript|loading\.\.\.|javascript is required)/i.test(bodyText);
  return (hasAppRoot && bodyText.length < 240) || (hasJsNotice && bodyText.length < 400);
}

export function buildCleanPageText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 24_000);
}

export async function fetchPageWithSession(
  url: string,
  options: {
    sessionAuth?: SessionHeaderPayload | null;
    timeoutMs?: number;
  } = {}
): Promise<PageFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (compatible; ScrapeSmith/1.0; +https://scrapesmith.app) AppleWebKit/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (options.sessionAuth?.headerName && options.sessionAuth?.headerValue) {
    headers[options.sessionAuth.headerName] = options.sessionAuth.headerValue;
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') ?? '';
    const html = await res.text();
    const finalUrl = res.url || url;
    const authCheck = detectLoginWallInHtml(res.status, url, finalUrl, html);
    const expandedTables = expandHtmlTables(html);
    const hydrationPayloads = extractHydrationData(html);
    const isLikelySpaShell = detectSpaShell(html);

    return {
      ok: res.ok && !authCheck.authRequired,
      status: res.status,
      finalUrl,
      html,
      authRequired: authCheck.authRequired,
      authHint: authCheck.authHint,
      contentType,
      hydrationPayloads,
      expandedTables,
      isLikelySpaShell,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
