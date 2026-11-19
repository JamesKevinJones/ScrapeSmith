export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'date' | 'list';

export type ExtractionMode = 'single' | 'list';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type UrlTaskStatus =
  | 'queued'
  | 'fetching'
  | 'extracting'
  | 'done'
  | 'failed'
  | 'auth_required';

export type ExtractionMethod =
  | 'url_context'
  | 'google_search'
  | 'dom_rules'
  | 'authenticated_fetch';

export type CellValue = string | number | boolean | string[] | null;

export interface FieldExtractionRule {
  cssSelector?: string;
  attribute?: string;
  expandMergedCells?: boolean;
  waitForDynamic?: boolean;
  dynamicWaitMs?: number;
  fallbackToAi?: boolean;
}

export interface FieldDefinition {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  rules?: FieldExtractionRule;
}

export interface JsonSchemaProperty {
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'array'
    | 'object'
    | Array<'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'>;
  description?: string;
  format?: string;
  enum?: string[];
  nullable?: boolean;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchema {
  $schema?: string;
  title?: string;
  type: 'object';
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ExtractedRow {
  _id: string;
  _sourceUrl: string;
  _edited?: boolean;
  confidence: ConfidenceLevel;
  source_snippet: string;
  notes?: string | null;
  values: Record<string, CellValue>;
}

export interface UrlExtractionTask {
  id: string;
  url: string;
  status: UrlTaskStatus;
  method?: ExtractionMethod;
  rowCount: number;
  error?: string;
  authRequired?: boolean;
  authHint?: string;
  startedAt?: string;
  completedAt?: string;
  repaired?: boolean;
}

export type SessionAuthType =
  | 'session_cookie'
  | 'bearer_token'
  | 'basic_credentials'
  | 'manual_relogin';

export interface TemporarySession {
  origin: string;
  authType: SessionAuthType;
  headerName: 'Cookie' | 'Authorization';
  headerValue: string;
  maskedPreview: string;
  loginUrl?: string;
  createdAt: number;
  expiresAt: number;
  verified?: boolean;
  verifiedStatus?: number;
}

export interface SessionHeaderPayload {
  headerName: 'Cookie' | 'Authorization';
  headerValue: string;
}

export interface CreativeStudioPayload {
  source_urls: string[];
  fields: Array<{
    name: string;
    type: FieldType;
    description?: string;
  }>;
  rows: Array<Record<string, unknown>>;
  extracted_at: string;
}

export interface HistoryRun {
  id: string;
  createdAt: string;
  urls: string[];
  topicQuery?: string | null;
  fieldsText: string;
  fields: FieldDefinition[];
  mode: ExtractionMode;
  schemaText: string;
  rows: ExtractedRow[];
  tasks: UrlExtractionTask[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export interface ParsedTargetInput {
  inputKind: 'urls' | 'topic' | 'empty';
  validUrls: string[];
  duplicateCount: number;
  overflowCount: number;
  invalidEntries: string[];
  topicQuery: string | null;
}

export interface PiiCheckResult {
  blocked: boolean;
  matchedTerms: string[];
  message: string;
}

export interface GenerateSchemaRequest {
  fieldsText: string;
  fields: FieldDefinition[];
  mode: ExtractionMode;
}

export interface GenerateSchemaResponse {
  schema: JsonSchema;
  fields: FieldDefinition[];
  repaired?: boolean;
}

export interface DiscoverUrlsRequest {
  topic: string;
  fieldsText?: string;
}

export interface DiscoverUrlsResponse {
  urls: Array<{ url: string; title: string }>;
}

export interface ExtractUrlRequest {
  url: string;
  mode: ExtractionMode;
  fields: FieldDefinition[];
  schema: JsonSchema;
  allowSearchFallback?: boolean;
  sessionAuth?: SessionHeaderPayload | null;
}

export interface ExtractUrlResponse {
  url: string;
  method: ExtractionMethod;
  rows: ExtractedRow[];
  failedReason?: string | null;
  authRequired?: boolean;
  authHint?: string | null;
  repaired?: boolean;
}

export interface VerifySessionRequest {
  url: string;
  sessionAuth: SessionHeaderPayload;
}

export interface VerifySessionResponse {
  ok: boolean;
  status: number;
  finalUrl: string;
  loginDetected: boolean;
  message: string;
}

export interface GoogleSpreadsheetSummary {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface GoogleWorksheetInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

export interface SheetColumnMapping {
  sourceKey: string;
  label: string;
  sheetHeader: string;
  included: boolean;
  isMeta?: boolean;
}

export type SheetExportMode = 'append' | 'overwrite';

export type ActiveTab = 'workbench' | 'schema' | 'results' | 'history';
