import type {
  ExtractedRow,
  GoogleSpreadsheetSummary,
  GoogleWorksheetInfo,
  SheetColumnMapping,
  SheetExportMode,
} from '../types';
import { buildSheetValuesMatrix } from '../utils/sheetsMapping';

export class GoogleSheetsApiError extends Error {
  status: number;
  needsReauth: boolean;

  constructor(message: string, status: number, needsReauth = false) {
    super(message);
    this.name = 'GoogleSheetsApiError';
    this.status = status;
    this.needsReauth = needsReauth;
  }
}

async function googleApiFetch<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      `Google Workspace API request failed (HTTP ${response.status}).`;
    throw new GoogleSheetsApiError(
      apiMessage,
      response.status,
      response.status === 401
    );
  }

  return data as T;
}

export async function listUserSpreadsheets(
  accessToken: string
): Promise<GoogleSpreadsheetSummary[]> {
  const query = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const fields = encodeURIComponent('files(id,name,modifiedTime,webViewLink)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc&pageSize=30`;

  const data = await googleApiFetch<{ files?: GoogleSpreadsheetSummary[] }>(url, accessToken);
  return data.files ?? [];
}

export async function getSpreadsheetWorksheets(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: GoogleWorksheetInfo[];
}> {
  const fields = encodeURIComponent(
    'spreadsheetId,properties.title,spreadsheetUrl,sheets(properties(sheetId,title,gridProperties))'
  );
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${fields}`;

  const data = await googleApiFetch<{
    spreadsheetId: string;
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  }>(url, accessToken);

  const sheets: GoogleWorksheetInfo[] = (data.sheets ?? [])
    .filter((s) => s.properties?.title)
    .map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties!.title!,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
    }));

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? 'Untitled Spreadsheet',
    spreadsheetUrl:
      data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
    sheets,
  };
}

export async function createNewSpreadsheet(
  accessToken: string,
  title: string,
  worksheetTitle = 'Extracted Data'
): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: GoogleWorksheetInfo[];
}> {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets';
  const data = await googleApiFetch<{
    spreadsheetId: string;
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{
      properties?: { sheetId?: number; title?: string };
    }>;
  }>(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: title.trim() || 'ScrapeSmith Export' },
      sheets: [{ properties: { title: worksheetTitle.trim() || 'Extracted Data' } }],
    }),
  });

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? title,
    spreadsheetUrl:
      data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
    sheets: (data.sheets ?? []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? worksheetTitle,
    })),
  };
}

function escapeSheetTitleForA1(sheetTitle: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return `'${escaped}'`;
}

export async function exportRowsToGoogleSheet(
  accessToken: string,
  params: {
    spreadsheetId: string;
    sheetTitle: string;
    mode: SheetExportMode;
    columnMappings: SheetColumnMapping[];
    rows: ExtractedRow[];
    includeHeaders: boolean;
  }
): Promise<{ updatedRows: number; updatedRange: string }> {
  const sheetRef = escapeSheetTitleForA1(params.sheetTitle);
  const encodedSheetRef = encodeURIComponent(sheetRef);

  if (params.mode === 'overwrite') {
    // 1. Clear existing worksheet values
    await googleApiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodedSheetRef}:clear`,
      accessToken,
      { method: 'POST', body: JSON.stringify({}) }
    );

    // 2. Write fresh values starting at A1
    const values = buildSheetValuesMatrix(params.columnMappings, params.rows, params.includeHeaders);
    const range = encodeURIComponent(`${sheetRef}!A1`);
    const updateRes = await googleApiFetch<{
      updatedRows?: number;
      updatedRange?: string;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values,
        }),
      }
    );

    return {
      updatedRows: updateRes.updatedRows ?? values.length,
      updatedRange: updateRes.updatedRange ?? `${params.sheetTitle}!A1`,
    };
  }

  // Append mode: check if A1 already has content so we don't duplicate header rows unexpectedly
  let shouldWriteHeader = params.includeHeaders;
  if (params.includeHeaders) {
    const checkRange = encodeURIComponent(`${sheetRef}!A1:A1`);
    try {
      const existing = await googleApiFetch<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${checkRange}`,
        accessToken
      );
      if (existing.values && existing.values.length > 0 && existing.values[0]?.[0]) {
        shouldWriteHeader = false;
      }
    } catch {
      // Proceed with user's includeHeaders preference
    }
  }

  const values = buildSheetValuesMatrix(params.columnMappings, params.rows, shouldWriteHeader);
  const appendRange = encodeURIComponent(`${sheetRef}!A1`);
  const appendRes = await googleApiFetch<{
    updates?: { updatedRows?: number; updatedRange?: string };
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${appendRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values,
      }),
    }
  );

  return {
    updatedRows: appendRes.updates?.updatedRows ?? values.length,
    updatedRange: appendRes.updates?.updatedRange ?? `${params.sheetTitle}!A1`,
  };
}
