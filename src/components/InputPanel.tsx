import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  KeyRound,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ExtractionMode,
  FieldDefinition,
  FieldExtractionRule,
  FieldType,
  ParsedTargetInput,
  PiiCheckResult,
} from '../types';
import { EXTRACTION_PRESETS, type ExtractionPreset } from '../utils/presets';
import { slugifyFieldName } from '../utils/schemaBuilder';
import { MAX_URLS } from '../utils/urlParser';

interface InputPanelProps {
  urlsText: string;
  onUrlsTextChange: (value: string) => void;
  parsedTargets: ParsedTargetInput;
  fieldsText: string;
  onFieldsTextChange: (value: string) => void;
  onApplyFieldsText: () => void;
  fields: FieldDefinition[];
  onAddField: (name: string, type: FieldType) => void;
  onUpdateFieldType: (id: string, type: FieldType) => void;
  onUpdateFieldRules: (id: string, rules: FieldExtractionRule | undefined) => void;
  onRemoveField: (id: string) => void;
  mode: ExtractionMode;
  onModeChange: (mode: ExtractionMode) => void;
  piiCheck: PiiCheckResult;
  isGeneratingSchema: boolean;
  onGenerateSchemaAi: () => void;
  onApplyPreset: (preset: ExtractionPreset) => void;
  activeSessionCount: number;
  onOpenReauth: () => void;
}

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'url', 'date', 'list'];

const ATTRIBUTE_PRESETS = ['text', 'href', 'src', 'content', 'data-price', 'data-value'];

function summarizeFieldRules(rules?: FieldExtractionRule): string[] {
  if (!rules) return [];
  const tags: string[] = [];
  if (rules.cssSelector?.trim()) tags.push('CSS');
  if (rules.expandMergedCells) tags.push('Table');
  if (rules.waitForDynamic) tags.push('JS');
  return tags;
}

export function InputPanel({
  urlsText,
  onUrlsTextChange,
  parsedTargets,
  fieldsText,
  onFieldsTextChange,
  onApplyFieldsText,
  fields,
  onAddField,
  onUpdateFieldType,
  onUpdateFieldRules,
  onRemoveField,
  mode,
  onModeChange,
  piiCheck,
  isGeneratingSchema,
  onGenerateSchemaAi,
  onApplyPreset,
  activeSessionCount,
  onOpenReauth,
}: InputPanelProps) {
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('string');
  const [editingRuleFieldId, setEditingRuleFieldId] = useState<string | null>(null);

  const activeRuleField = fields.find((f) => f.id === editingRuleFieldId) ?? null;

  const handleAddChip = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = slugifyFieldName(newFieldName);
    if (!newFieldName.trim() || !cleaned) return;
    onAddField(cleaned, newFieldType);
    setNewFieldName('');
    setNewFieldType('string');
  };

  const patchRule = (field: FieldDefinition, patch: Partial<FieldExtractionRule>) => {
    const next: FieldExtractionRule = {
      fallbackToAi: true,
      ...(field.rules ?? {}),
      ...patch,
    };
    const isEmpty =
      !next.cssSelector?.trim() &&
      !next.expandMergedCells &&
      !next.waitForDynamic &&
      (!next.attribute || next.attribute === 'text');
    onUpdateFieldRules(field.id, isEmpty ? undefined : next);
  };

  return (
    <section
      aria-label="Extraction configuration"
      className="rounded-lg border border-white/[0.08] bg-[#131519] p-5 space-y-5"
    >
      {/* Header + Sessions Trigger */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F3F4F6]">Target Sources & Fields</h2>
          <button
            type="button"
            onClick={onOpenReauth}
            className={`inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              activeSessionCount > 0
                ? 'border-[#3B82F6]/40 bg-[#3B82F6]/15 text-[#93C5FD] hover:bg-[#3B82F6]/25'
                : 'border-white/[0.09] bg-[#1A1D23] text-[#9CA3AF] hover:border-white/[0.16] hover:text-[#F3F4F6]'
            }`}
          >
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            <span>{activeSessionCount > 0 ? `Sessions (${activeSessionCount})` : 'Session Auth'}</span>
          </button>
        </div>

        {/* Clean single-row quick presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#6B7280] mr-0.5">Presets:</span>
          {EXTRACTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className="rounded border border-white/[0.08] bg-[#1A1D23] px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:border-white/[0.16] hover:text-[#F3F4F6] transition-colors whitespace-nowrap"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Multi-URL / Topic Textarea */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="target-urls-input" className="text-xs font-medium text-[#D1D5DB]">
            Target URLs (one per line, max {MAX_URLS}) or a search topic
          </label>
          <span className="text-xs text-[#9CA3AF] tabular-nums whitespace-nowrap shrink-0">
            {parsedTargets.inputKind === 'topic'
              ? 'Topic discovery'
              : `${parsedTargets.validUrls.length} / ${MAX_URLS} valid`}
          </span>
        </div>

        <textarea
          id="target-urls-input"
          rows={4}
          value={urlsText}
          onChange={(e) => onUrlsTextChange(e.target.value)}
          placeholder={`https://books.toscrape.com/catalogue/category/books/science_22/index.html\nhttps://example.org/pricing\nOr enter a topic to discover 3–5 public pages via Google Search`}
          className="w-full rounded-md border border-white/[0.09] bg-[#0B0C0E] px-3 py-2.5 font-mono text-xs leading-relaxed text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6] resize-y"
        />

        {/* Live URL validation metadata */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#9CA3AF] tabular-nums">
          {parsedTargets.inputKind === 'empty' && (
            <span>Paste public HTTP(S) URLs or enter a topic to search.</span>
          )}
          {parsedTargets.inputKind === 'topic' && (
            <span className="text-[#93C5FD]">
              Google Search will find 3–5 reputable pages for &ldquo;{parsedTargets.topicQuery}&rdquo;, then extract.
            </span>
          )}
          {parsedTargets.inputKind === 'urls' && (
            <>
              <span className="text-[#D1D5DB]">
                {parsedTargets.validUrls.length} unique URL{parsedTargets.validUrls.length === 1 ? '' : 's'} ready
              </span>
              {parsedTargets.duplicateCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{parsedTargets.duplicateCount} duplicate removed</span>
                </>
              )}
              {parsedTargets.overflowCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-400">
                    {parsedTargets.overflowCount} skipped (max {MAX_URLS})
                  </span>
                </>
              )}
              {parsedTargets.invalidEntries.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-rose-400">
                    {parsedTargets.invalidEntries.length} invalid line{parsedTargets.invalidEntries.length === 1 ? '' : 's'} ignored
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {parsedTargets.invalidEntries.length > 0 && (
          <div
            role="status"
            className="rounded-md border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-300"
          >
            Invalid URLs ignored: <span className="font-mono">{parsedTargets.invalidEntries.slice(0, 3).join(', ')}</span>
            {parsedTargets.invalidEntries.length > 3 ? ` (+${parsedTargets.invalidEntries.length - 3} more)` : ''}
          </div>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="space-y-2">
        <span id="extraction-mode-label" className="block text-xs font-medium text-[#D1D5DB]">
          Extraction Mode
        </span>
        <div
          role="radiogroup"
          aria-labelledby="extraction-mode-label"
          className="grid grid-cols-2 gap-1 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'single'}
            onClick={() => onModeChange('single')}
            className={`rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'single'
                ? 'bg-[#1F242E] text-[#F3F4F6]'
                : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
            }`}
          >
            Single item per page
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'list'}
            onClick={() => onModeChange('list')}
            className={`rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'list'
                ? 'bg-[#1F242E] text-[#F3F4F6]'
                : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
            }`}
          >
            List of items per page
          </button>
        </div>
      </div>

      {/* Free-text Fields Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="fields-free-text" className="text-xs font-medium text-[#D1D5DB]">
            Fields to extract (plain English)
          </label>
          <button
            type="button"
            onClick={onGenerateSchemaAi}
            disabled={isGeneratingSchema || (!fieldsText.trim() && fields.length === 0) || piiCheck.blocked}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#60A5FA] hover:text-[#93C5FD] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isGeneratingSchema ? 'Generating Schema…' : 'Refine Schema with AI'}</span>
          </button>
        </div>

        <div className="flex gap-2">
          <input
            id="fields-free-text"
            type="text"
            value={fieldsText}
            onChange={(e) => onFieldsTextChange(e.target.value)}
            onBlur={onApplyFieldsText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                onApplyFieldsText();
              }
            }}
            placeholder="e.g. product name, price, rating, review count, in_stock"
            className="min-w-0 flex-1 rounded-md border border-white/[0.09] bg-[#0B0C0E] px-3 py-2 text-sm text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
          />
          <button
            type="button"
            onClick={onApplyFieldsText}
            className="rounded-md border border-white/[0.1] bg-[#1A1D23] px-3 py-2 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] transition-colors whitespace-nowrap shrink-0"
          >
            Parse Fields
          </button>
        </div>
      </div>

      {/* Field Chip Builder + Per-Field Advanced Rules */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-[#D1D5DB]">Field Builder & Advanced Rules</span>
          <span className="text-xs text-[#9CA3AF] tabular-nums">
            {fields.length} field{fields.length === 1 ? '' : 's'}
          </span>
        </div>

        <form onSubmit={handleAddChip} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <input
            type="text"
            aria-label="New field name"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            placeholder="Add field name (e.g. sku)"
            className="min-w-0 flex-1 rounded-md border border-white/[0.09] bg-[#0B0C0E] px-3 py-1.5 font-mono text-xs text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
          />
          <select
            aria-label="New field type"
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value as FieldType)}
            className="rounded-md border border-white/[0.09] bg-[#0B0C0E] px-2.5 py-1.5 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newFieldName.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-[#1A1D23] px-3 py-1.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add</span>
          </button>
        </form>

        {fields.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-testid="field-chips-list">
            {fields.map((field) => {
              const ruleTags = summarizeFieldRules(field.rules);
              const isRuleOpen = editingRuleFieldId === field.id;
              return (
                <div
                  key={field.id}
                  className={`inline-flex items-center gap-1.5 rounded-md border bg-[#0B0C0E] pl-2.5 pr-1 py-1 text-xs transition-colors ${
                    isRuleOpen
                      ? 'border-[#3B82F6]/60'
                      : ruleTags.length > 0
                        ? 'border-[#3B82F6]/30'
                        : 'border-white/[0.1]'
                  }`}
                >
                  <span className="font-mono text-[#E6E8EC]">{field.name}</span>
                  <select
                    aria-label={`Type for ${field.name}`}
                    value={field.type}
                    onChange={(e) => onUpdateFieldType(field.id, e.target.value as FieldType)}
                    className="rounded bg-[#1A1D23] px-1.5 py-0.5 font-mono text-[11px] text-[#93C5FD] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {ruleTags.length > 0 && (
                    <span className="font-mono text-[10px] text-amber-300">
                      {ruleTags.join('+')}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Advanced rules for ${field.name}`}
                    aria-expanded={isRuleOpen}
                    title="Configure CSS selector, merged table cells, or dynamic JS rules"
                    onClick={() =>
                      setEditingRuleFieldId((prev) => (prev === field.id ? null : field.id))
                    }
                    className={`rounded p-0.5 transition-colors ${
                      isRuleOpen || ruleTags.length > 0
                        ? 'text-[#60A5FA] bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25'
                        : 'text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#F3F4F6]'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove field ${field.name}`}
                    onClick={() => {
                      if (editingRuleFieldId === field.id) setEditingRuleFieldId(null);
                      onRemoveField(field.id);
                    }}
                    className="rounded p-0.5 text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#F3F4F6] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[#6B7280]">
            Add at least one field above to build the extraction schema.
          </p>
        )}

        {/* Inline Per-Field Advanced Extraction Rules Editor */}
        {activeRuleField && (
          <div
            aria-label={`Advanced extraction rules for ${activeRuleField.name}`}
            className="rounded-md border border-[#3B82F6]/35 bg-[#0B0C0E] p-3.5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[#F3F4F6]">
                Advanced Rules: <code className="text-[#93C5FD]">{activeRuleField.name}</code>
              </span>
              <div className="flex items-center gap-2">
                {activeRuleField.rules && (
                  <button
                    type="button"
                    onClick={() => onUpdateFieldRules(activeRuleField.id, undefined)}
                    className="text-[11px] text-[#9CA3AF] hover:text-rose-400"
                  >
                    Clear rules
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingRuleFieldId(null)}
                  className="text-[11px] font-medium text-[#60A5FA] hover:text-[#93C5FD]"
                >
                  Done
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-2">
              <div className="space-y-1">
                <label htmlFor="field-css-selector" className="block text-[11px] text-[#9CA3AF]">
                  CSS Selector Override (optional)
                </label>
                <input
                  id="field-css-selector"
                  type="text"
                  value={activeRuleField.rules?.cssSelector ?? ''}
                  onChange={(e) =>
                    patchRule(activeRuleField, { cssSelector: e.target.value })
                  }
                  placeholder="e.g. article.product_pod h3 a, table.specs td:nth-child(2)"
                  className="w-full rounded border border-white/[0.1] bg-[#131519] px-2.5 py-1.5 font-mono text-[11px] text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="field-css-attr" className="block text-[11px] text-[#9CA3AF]">
                  Target Attribute
                </label>
                <input
                  id="field-css-attr"
                  type="text"
                  list="attr-presets"
                  value={activeRuleField.rules?.attribute ?? 'text'}
                  onChange={(e) =>
                    patchRule(activeRuleField, { attribute: e.target.value })
                  }
                  placeholder="text"
                  className="w-full rounded border border-white/[0.1] bg-[#131519] px-2.5 py-1.5 font-mono text-[11px] text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                />
                <datalist id="attr-presets">
                  {ATTRIBUTE_PRESETS.map((attr) => (
                    <option key={attr} value={attr} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-2 pt-0.5">
              <label className="flex items-start gap-2 text-[#D1D5DB] cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(activeRuleField.rules?.expandMergedCells)}
                  onChange={(e) =>
                    patchRule(activeRuleField, { expandMergedCells: e.target.checked })
                  }
                  className="mt-0.5 rounded accent-[#3B82F6]"
                />
                <span>
                  Expand merged HTML table cells (<code className="text-[#93C5FD]">colspan</code> /{' '}
                  <code className="text-[#93C5FD]">rowspan</code>) into normalized rows
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-start gap-2 text-[#D1D5DB] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(activeRuleField.rules?.waitForDynamic)}
                    onChange={(e) =>
                      patchRule(activeRuleField, {
                        waitForDynamic: e.target.checked,
                        dynamicWaitMs: e.target.checked
                          ? activeRuleField.rules?.dynamicWaitMs ?? 1500
                          : undefined,
                      })
                    }
                    className="mt-0.5 rounded accent-[#3B82F6]"
                  />
                  <span>Handle dynamic JS-rendered / hydration content</span>
                </label>

                {activeRuleField.rules?.waitForDynamic && (
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
                    <label htmlFor="dynamic-wait-ms">Wait (ms):</label>
                    <input
                      id="dynamic-wait-ms"
                      type="number"
                      min={250}
                      max={10000}
                      step={250}
                      value={activeRuleField.rules?.dynamicWaitMs ?? 1500}
                      onChange={(e) =>
                        patchRule(activeRuleField, {
                          dynamicWaitMs: Math.max(250, Number(e.target.value) || 1500),
                        })
                      }
                      className="w-20 rounded border border-white/[0.1] bg-[#131519] px-2 py-0.5 font-mono text-[11px] text-[#E6E8EC] tabular-nums focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {activeRuleField.rules?.cssSelector?.trim() && (
                <label className="flex items-start gap-2 text-[#9CA3AF] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeRuleField.rules?.fallbackToAi !== false}
                    onChange={(e) =>
                      patchRule(activeRuleField, { fallbackToAi: e.target.checked })
                    }
                    className="mt-0.5 rounded accent-[#3B82F6]"
                  />
                  <span>Fall back to Gemini AI if CSS selector returns no elements</span>
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PII Privacy Refusal Notice */}
      {piiCheck.blocked && (
        <div
          role="alert"
          className="rounded-md border border-rose-500/35 bg-rose-500/[0.08] p-3.5 text-xs leading-relaxed text-rose-200 space-y-1"
        >
          <div className="flex items-center gap-2 font-semibold text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Personal Data Extraction Blocked</span>
          </div>
          <p>{piiCheck.message}</p>
        </div>
      )}

      {/* Ethics & Safety Notice */}
      <div className="rounded-md border border-white/[0.07] bg-[#0B0C0E]/80 p-3.5 text-xs leading-relaxed text-[#9CA3AF] flex items-start gap-2.5">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#60A5FA] mt-0.5" aria-hidden="true" />
        <p>
          <span className="font-medium text-[#D1D5DB]">Responsible extraction notice:</span> Respect each
          site&apos;s Terms of Service and <code className="text-[#D1D5DB]">robots.txt</code>. Only use
          session re-authentication with accounts you are authorized to access; ScrapeSmith refuses
          requests to extract personal data of private individuals.
        </p>
      </div>
    </section>
  );
}
