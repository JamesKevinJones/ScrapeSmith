import type {
  ExtractionMode,
  FieldDefinition,
  FieldType,
  JsonSchema,
  JsonSchemaProperty,
} from '../types';

export const RESERVED_FIELD_NAMES = new Set([
  'confidence',
  'source_snippet',
  'notes',
  'source_url',
  '_id',
  '_sourceUrl',
]);

export function slugifyFieldName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return 'field';
  return /^[0-9]/.test(cleaned) ? `f_${cleaned}` : cleaned;
}

export function inferFieldType(fieldName: string): FieldType {
  const lower = fieldName.toLowerCase();

  if (/(^|_)(url|link|href|website|homepage|image|thumbnail|photo|avatar|source_link)(_|$)/.test(lower)) {
    return 'url';
  }
  if (/(^|_)(date|published|released|created|updated|deadline|timestamp|birthday|year_month)(_|$)/.test(lower)) {
    return 'date';
  }
  if (/(^|_)(is|has|in_stock|available|verified|active|featured|free|open_source|supported)(_|$)/.test(lower)) {
    return 'boolean';
  }
  if (/(^|_)(tags|features|categories|items|ingredients|pros|cons|colors|sizes|authors|specs|highlights|topics|keywords)(_|$)/.test(lower)) {
    return 'list';
  }
  if (/(^|_)(price|cost|amount|rating|score|count|reviews|review_count|stars|quantity|stock|weight|length|width|height|rank|discount|percent|total|revenue|downloads|followers|views|likes|episodes|pages|calories|duration)(_|$)/.test(lower)) {
    return 'number';
  }

  return 'string';
}

export function parseFreeTextToFields(text: string): FieldDefinition[] {
  const rawTokens = text
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const fields: FieldDefinition[] = [];

  for (const token of rawTokens) {
    // Support optional inline type notation like "price: number" or "tags (list)"
    let namePart = token;
    let explicitType: FieldType | null = null;

    const colonMatch = token.match(/^([^:]+):\s*(string|number|boolean|url|date|list)$/i);
    const parenMatch = token.match(/^([^(]+)\((string|number|boolean|url|date|list)\)$/i);

    if (colonMatch) {
      namePart = colonMatch[1];
      explicitType = colonMatch[2].toLowerCase() as FieldType;
    } else if (parenMatch) {
      namePart = parenMatch[1];
      explicitType = parenMatch[2].toLowerCase() as FieldType;
    }

    const name = slugifyFieldName(namePart);
    if (!name || RESERVED_FIELD_NAMES.has(name) || seen.has(name)) {
      continue;
    }

    seen.add(name);
    fields.push({
      id: `field_${name}`,
      name,
      type: explicitType ?? inferFieldType(name),
      description: namePart.trim(),
    });
  }

  return fields;
}

export function fieldTypeToSchemaProperty(field: FieldDefinition): JsonSchemaProperty {
  const baseDesc = field.description && field.description !== field.name
    ? field.description
    : `Extracted ${field.name.replace(/_/g, ' ')} value from page, or null if absent.`;

  switch (field.type) {
    case 'number':
      return {
        type: ['number', 'null'],
        description: `${baseDesc} Numeric value only (note currency/unit in row notes if applicable).`,
      };
    case 'boolean':
      return {
        type: ['boolean', 'null'],
        description: baseDesc,
      };
    case 'url':
      return {
        type: ['string', 'null'],
        format: 'uri',
        description: `${baseDesc} Absolute URL if visible on page.`,
      };
    case 'date':
      return {
        type: ['string', 'null'],
        format: 'date',
        description: `${baseDesc} Normalized to ISO 8601 (YYYY-MM-DD) when stated.`,
      };
    case 'list':
      return {
        type: ['array', 'null'],
        items: { type: 'string' },
        description: `${baseDesc} List of strings visibly listed on the page.`,
      };
    case 'string':
    default:
      return {
        type: ['string', 'null'],
        description: baseDesc,
      };
  }
}

export function fieldsToJsonSchema(fields: FieldDefinition[], mode: ExtractionMode): JsonSchema {
  const rowProperties: Record<string, JsonSchemaProperty> = {};
  const rowRequired: string[] = [];

  for (const field of fields) {
    if (!field.name || RESERVED_FIELD_NAMES.has(field.name)) continue;
    rowProperties[field.name] = fieldTypeToSchemaProperty(field);
    rowRequired.push(field.name);
  }

  rowProperties.confidence = {
    type: 'string',
    enum: ['high', 'medium', 'low'],
    description: 'high = stated explicitly, medium = light interpretation, low = ambiguous',
  };
  rowProperties.source_snippet = {
    type: 'string',
    description: 'Short exact quote from the page proving the extracted values.',
  };
  rowProperties.notes = {
    type: ['string', 'null'],
    description: 'Optional normalization notes such as currency code (e.g. USD) or unit.',
  };

  rowRequired.push('confidence', 'source_snippet');

  const rowObject: JsonSchemaProperty = {
    type: 'object',
    properties: rowProperties,
    required: rowRequired,
  };

  if (mode === 'list') {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'ScrapeSmithListExtraction',
      type: 'object',
      description: 'List of items extracted from a single web page.',
      properties: {
        items: {
          type: 'array',
          description: 'All matching items visibly present on the page.',
          items: rowObject,
        },
        failed_reason: {
          type: ['string', 'null'],
          description: 'Reason if the page failed to load, requires login, or is paywalled; otherwise null.',
        },
      },
      required: ['items'],
    };
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ScrapeSmithSingleExtraction',
    type: 'object',
    description: 'Single item extracted from a web page.',
    properties: {
      item: {
        ...rowObject,
        nullable: true,
        description: 'Single extracted record, or null if page failed / no matching entity found.',
      },
      failed_reason: {
        type: ['string', 'null'],
        description: 'Reason if the page failed to load, requires login, or is paywalled; otherwise null.',
      },
    },
    required: ['item'],
  };
}

function inferFieldTypeFromSchemaProp(prop: JsonSchemaProperty): FieldType {
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  const primary = types.find((t) => t !== 'null') ?? 'string';

  if (primary === 'number') return 'number';
  if (primary === 'boolean') return 'boolean';
  if (primary === 'array') return 'list';
  if (primary === 'string') {
    if (prop.format === 'uri' || prop.format === 'url') return 'url';
    if (prop.format === 'date' || prop.format === 'date-time') return 'date';
  }
  return 'string';
}

export interface ParsedSchemaResult {
  valid: boolean;
  schema?: JsonSchema;
  fields?: FieldDefinition[];
  mode?: ExtractionMode;
  error?: string;
}

export function parseJsonSchemaText(schemaText: string): ParsedSchemaResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaText);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON syntax.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Schema root must be a JSON object.' };
  }

  const root = parsed as Record<string, unknown>;
  if (root.type !== 'object' || !root.properties || typeof root.properties !== 'object') {
    return { valid: false, error: 'Schema must have "type": "object" and a "properties" map.' };
  }

  const props = root.properties as Record<string, JsonSchemaProperty>;
  let mode: ExtractionMode = 'single';
  let rowProps: Record<string, JsonSchemaProperty> | undefined;

  if (props.items && props.items.items && props.items.items.properties) {
    mode = 'list';
    rowProps = props.items.items.properties;
  } else if (props.item && props.item.properties) {
    mode = 'single';
    rowProps = props.item.properties;
  } else {
    // Allow users who write a flat object schema directly
    mode = 'single';
    rowProps = props;
  }

  if (!rowProps || Object.keys(rowProps).length === 0) {
    return { valid: false, error: 'Schema must define at least one field property.' };
  }

  const fields: FieldDefinition[] = [];
  for (const [key, prop] of Object.entries(rowProps)) {
    if (RESERVED_FIELD_NAMES.has(key) || key === 'failed_reason') continue;
    if (!prop || typeof prop !== 'object') continue;
    fields.push({
      id: `field_${key}`,
      name: key,
      type: inferFieldTypeFromSchemaProp(prop),
      description: prop.description,
    });
  }

  if (fields.length === 0) {
    return {
      valid: false,
      error: 'Schema must include at least one data field besides confidence and source_snippet.',
    };
  }

  return {
    valid: true,
    schema: parsed as JsonSchema,
    fields,
    mode,
  };
}
