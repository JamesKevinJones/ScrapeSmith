import type { FieldDefinition, PiiCheckResult } from '../types';

interface PiiRule {
  label: string;
  pattern: RegExp;
}

const PII_RULES: PiiRule[] = [
  {
    label: 'email addresses',
    pattern: /\b(e[-_\s]?mail|email[-_\s]?address|personal[-_\s]?email|contact[-_\s]?email|gmail|inbox)\b/i,
  },
  {
    label: 'phone numbers',
    pattern: /\b(phone|phone[-_\s]?number|mobile|cell[-_\s]?phone|telephone|whatsapp|sms[-_\s]?number|direct[-_\s]?dial)\b/i,
  },
  {
    label: 'home or residential addresses',
    pattern: /\b(home[-_\s]?address|residential[-_\s]?address|street[-_\s]?address|mailing[-_\s]?address|personal[-_\s]?address|apartment[-_\s]?number|zip[-_\s]?code\s+of\s+resident)\b/i,
  },
  {
    label: 'government IDs or SSNs',
    pattern: /\b(ssn|social[-_\s]?security|passport[-_\s]?number|driver'?s?[-_\s]?license|national[-_\s]?id|tax[-_\s]?id)\b/i,
  },
  {
    label: 'financial account numbers',
    pattern: /\b(credit[-_\s]?card|bank[-_\s]?account|routing[-_\s]?number|iban|cvv)\b/i,
  },
  {
    label: 'private personal details',
    pattern: /\b(date[-_\s]?of[-_\s]?birth|personal[-_\s]?contact|private[-_\s]?individual|home[-_\s]?phone)\b/i,
  },
];

// Explicit allowlist patterns for clearly non-personal commercial/public fields
const SAFE_COMMERCIAL_OVERRIDES = [
  /\b(support|press|company|store|branch|office)[-_ ]?(url|page|website|location|hours)\b/i,
  /\b(shipping|delivery)[-_ ]?(time|cost|fee|policy)\b/i,
];

function collectMatches(text: string): string[] {
  const cleaned = SAFE_COMMERCIAL_OVERRIDES.reduce(
    (acc, rx) => acc.replace(rx, ' '),
    text
  );

  const matched: string[] = [];
  for (const rule of PII_RULES) {
    if (rule.pattern.test(cleaned)) {
      matched.push(rule.label);
    }
  }
  return matched;
}

export function checkPiiViolation(
  fieldsText: string,
  fields: FieldDefinition[],
  schemaText = ''
): PiiCheckResult {
  const candidates = [
    fieldsText,
    ...fields.map((f) => `${f.name} ${f.description ?? ''}`),
    schemaText,
  ].join(' | ');

  const matchedSet = new Set<string>(collectMatches(candidates));
  const matchedTerms = Array.from(matchedSet);

  if (matchedTerms.length === 0) {
    return {
      blocked: false,
      matchedTerms: [],
      message: '',
    };
  }

  return {
    blocked: true,
    matchedTerms,
    message: `ScrapeSmith cannot extract personal or private contact data (${matchedTerms.join(', ')}). Please remove private individual fields and limit extraction to publicly available product, catalog, or editorial information.`,
  };
}
