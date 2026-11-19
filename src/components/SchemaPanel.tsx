import { Check, Code2, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';

interface SchemaPanelProps {
  schemaText: string;
  onSchemaTextChange: (value: string) => void;
  schemaError: string | null;
  isDirty: boolean;
  isGeneratingSchema: boolean;
  onSyncSchemaToFields: () => void;
  onResetSchemaFromFields: () => void;
  onFormatSchema: () => void;
  onGenerateSchemaAi: () => void;
  piiBlocked: boolean;
  expanded?: boolean;
}

export function SchemaPanel({
  schemaText,
  onSchemaTextChange,
  schemaError,
  isDirty,
  isGeneratingSchema,
  onSyncSchemaToFields,
  onResetSchemaFromFields,
  onFormatSchema,
  onGenerateSchemaAi,
  piiBlocked,
  expanded = false,
}: SchemaPanelProps) {
  return (
    <section
      aria-label="JSON Schema editor"
      className="rounded-lg border border-white/[0.08] bg-[#131519] p-5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[#9CA3AF]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[#F3F4F6]">Extraction JSON Schema</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerateSchemaAi}
            disabled={isGeneratingSchema || piiBlocked}
            className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] bg-[#1A1D23] px-2.5 py-1 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#60A5FA]" aria-hidden="true" />
            <span>{isGeneratingSchema ? 'Generating…' : 'AI Generate'}</span>
          </button>

          <button
            type="button"
            onClick={onFormatSchema}
            disabled={Boolean(schemaError)}
            className="rounded border border-white/[0.08] bg-[#1A1D23] px-2.5 py-1 text-xs font-medium text-[#9CA3AF] hover:text-[#F3F4F6] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            Format
          </button>

          {isDirty && !schemaError && (
            <button
              type="button"
              onClick={onSyncSchemaToFields}
              className="inline-flex items-center gap-1 rounded bg-[#3B82F6]/20 border border-[#3B82F6]/40 px-2.5 py-1 text-xs font-medium text-[#93C5FD] hover:bg-[#3B82F6]/30 transition-colors whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sync to Fields</span>
            </button>
          )}

          <button
            type="button"
            onClick={onResetSchemaFromFields}
            title="Rebuild schema from current field chips"
            className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-[#1A1D23] px-2.5 py-1 text-xs font-medium text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors whitespace-nowrap"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-[#9CA3AF]">
        Passed directly as Gemini <code className="text-[#D1D5DB]">responseSchema</code>. Edit descriptions,
        types, or constraints before running. Missing fields are always returned as{' '}
        <code className="text-[#D1D5DB]">null</code>.
      </p>

      <textarea
        aria-label="Editable JSON schema"
        value={schemaText}
        onChange={(e) => onSchemaTextChange(e.target.value)}
        spellCheck={false}
        rows={expanded ? 24 : 11}
        className={`w-full rounded-md border bg-[#0B0C0E] p-3.5 font-mono text-xs leading-relaxed text-[#E6E8EC] focus:outline-none focus:ring-1 resize-y ${
          schemaError
            ? 'border-rose-500/50 focus:border-rose-500 focus:ring-rose-500'
            : 'border-white/[0.09] focus:border-[#3B82F6] focus:ring-[#3B82F6]'
        }`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {schemaError ? (
          <div role="alert" className="flex items-center gap-1.5 text-rose-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{schemaError}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[#9CA3AF]">
            <span className="text-emerald-400 font-medium">Valid JSON Schema</span>
            {isDirty && (
              <>
                <span aria-hidden="true">·</span>
                <span>Custom edits active</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
