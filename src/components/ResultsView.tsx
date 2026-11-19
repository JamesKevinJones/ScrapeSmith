import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Code,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Layers,
  Search,
  Send,
  Sheet,
  Table2,
  Trash2,
} from 'lucide-react';
import type {
  CellValue,
  ConfidenceLevel,
  ExtractedRow,
  FieldDefinition,
  FieldType,
} from '../types';
import {
  buildCreativeStudioPayload,
  downloadTextFile,
  exportToCsv,
  filterAndSortRows,
  formatCellValue,
  parseEditedCellValue,
  rowToCleanObject,
} from '../utils/dataTransforms';

interface ResultsViewProps {
  rows: ExtractedRow[];
  fields: FieldDefinition[];
  sourceUrls: string[];
  lastExtractedAt: string | null;
  isLoading: boolean;
  onEditCell: (rowId: string, fieldName: string, newValue: CellValue) => void;
  onDeleteRow: (rowId: string) => void;
  onDedupe: (key: string) => number;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
  onOpenGoogleSheets: () => void;
  onLoadStarterPreset?: () => void;
}

const CONFIDENCE_STYLE: Record<ConfidenceLevel, { label: string; textClass: string }> = {
  high: { label: 'High', textClass: 'text-emerald-400' },
  medium: { label: 'Medium', textClass: 'text-amber-400' },
  low: { label: 'Low', textClass: 'text-rose-400' },
};

export function ResultsView({
  rows,
  fields,
  sourceUrls,
  lastExtractedAt,
  isLoading,
  onEditCell,
  onDeleteRow,
  onDedupe,
  onNotify,
  onOpenGoogleSheets,
  onLoadStarterPreset,
}: ResultsViewProps) {
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel | 'all'>('all');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [dedupeKey, setDedupeKey] = useState<string>('__all__');
  const [copied, setCopied] = useState(false);

  const [editingCell, setEditingCell] = useState<{ rowId: string; fieldName: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const filteredRows = useMemo(
    () =>
      filterAndSortRows(rows, {
        query: searchQuery,
        confidence: confidenceFilter,
        sortKey,
        sortDir,
      }),
    [rows, searchQuery, confidenceFilter, sortKey, sortDir]
  );

  const rawJsonString = useMemo(() => {
    const clean = filteredRows.map((row) => rowToCleanObject(fields, row));
    return JSON.stringify(clean, null, 2);
  }, [filteredRows, fields]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const startEditing = (row: ExtractedRow, fieldName: string) => {
    setEditingCell({ rowId: row._id, fieldName });
    setEditDraft(formatCellValue(row.values[fieldName]));
  };

  const commitEdit = (type: FieldType) => {
    if (!editingCell) return;
    const parsed = parseEditedCellValue(editDraft, type);
    onEditCell(editingCell.rowId, editingCell.fieldName, parsed);
    setEditingCell(null);
  };

  const handleDedupeClick = () => {
    const removed = onDedupe(dedupeKey);
    if (removed > 0) {
      onNotify(
        'success',
        `Removed ${removed} duplicate row${removed === 1 ? '' : 's'}`,
        `Deduplicated by ${dedupeKey === '__all__' ? 'all fields' : dedupeKey}`
      );
    } else {
      onNotify(
        'info',
        'No duplicates found',
        `All rows are unique by ${dedupeKey === '__all__' ? 'all fields' : dedupeKey}.`
      );
    }
  };

  const handleExportCsv = () => {
    const csv = exportToCsv(fields, filteredRows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`scrapesmith-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    onNotify('success', 'CSV downloaded', `Exported ${filteredRows.length} row(s).`);
  };

  const handleExportJson = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`scrapesmith-${stamp}.json`, rawJsonString, 'application/json;charset=utf-8');
    onNotify('success', 'JSON downloaded', `Exported ${filteredRows.length} row(s).`);
  };

  const handleSendToCreativeStudio = () => {
    const payload = buildCreativeStudioPayload(
      sourceUrls.length > 0 ? sourceUrls : Array.from(new Set(rows.map((r) => r._sourceUrl))),
      fields,
      filteredRows,
      lastExtractedAt ?? new Date().toISOString()
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `creative-studio-dataset-${stamp}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
    onNotify(
      'success',
      'Downloaded for Creative Studio',
      `Exported ${payload.rows.length} row(s) from ${payload.source_urls.length} source URL(s).`
    );
  };

  const handleCopyClipboard = async () => {
    try {
      await navigator.clipboard.writeText(rawJsonString);
      setCopied(true);
      onNotify('success', 'Copied to clipboard', `Copied ${filteredRows.length} row(s) as JSON.`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify('error', 'Clipboard unavailable', 'Use the JSON download button instead.');
    }
  };

  const renderSortIcon = (key: string) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-[#6B7280]" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[#60A5FA]" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[#60A5FA]" aria-hidden="true" />
    );
  };

  return (
    <section
      aria-label="Extracted results"
      className="rounded-lg border border-white/[0.08] bg-[#131519] flex flex-col min-w-0"
    >
      {/* Results Header & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-[#F3F4F6]">Extracted Data</h2>
          <span className="text-xs text-[#9CA3AF] tabular-nums">
            {filteredRows.length} of {rows.length} row{rows.length === 1 ? '' : 's'}
            {lastExtractedAt
              ? ` · ${new Date(lastExtractedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </span>
        </div>

        {/* Export Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={handleExportCsv}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#1A1D23] px-2.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={handleExportJson}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#1A1D23] px-2.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={handleCopyClipboard}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#1A1D23] px-2.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenGoogleSheets}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
          >
            <Sheet className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Google Sheets</span>
          </button>

          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={handleSendToCreativeStudio}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3B82F6]/40 bg-[#3B82F6]/15 px-3 text-xs font-medium text-[#93C5FD] hover:bg-[#3B82F6]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Send to Creative Studio</span>
          </button>
        </div>
      </div>

      {/* Filter, View Toggle & Dedupe Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0F1115] px-5 py-3">
        <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto xl:flex-1 min-w-0">
          <div
            role="group"
            aria-label="Results view mode"
            className="inline-flex rounded-md border border-white/[0.08] bg-[#0B0C0E] p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-[#1F242E] text-[#F3F4F6]'
                  : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('json')}
              aria-pressed={viewMode === 'json'}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'json'
                  ? 'bg-[#1F242E] text-[#F3F4F6]'
                  : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
              }`}
            >
              <Code className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Raw JSON</span>
            </button>
          </div>

          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Filter extracted rows"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter rows…"
              className="h-8 w-full rounded-md border border-white/[0.08] bg-[#0B0C0E] pl-8 pr-2.5 text-xs text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
            />
          </div>

          <div className="inline-flex items-center gap-1.5 shrink-0">
            <Filter className="h-3.5 w-3.5 text-[#6B7280] shrink-0" aria-hidden="true" />
            <select
              aria-label="Filter by confidence"
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceLevel | 'all')}
              className="h-8 rounded-md border border-white/[0.08] bg-[#0B0C0E] px-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
            >
              <option value="all">All confidence</option>
              <option value="high">High confidence</option>
              <option value="medium">Medium confidence</option>
              <option value="low">Low confidence</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 max-w-full">
          <select
            aria-label="Dedupe key field"
            value={dedupeKey}
            onChange={(e) => setDedupeKey(e.target.value)}
            className="h-8 min-w-0 rounded-md border border-white/[0.08] bg-[#0B0C0E] px-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
          >
            <option value="__all__">Dedupe: All fields</option>
            {fields.map((f) => (
              <option key={f.id} value={f.name}>
                Key: {f.name}
              </option>
            ))}
            <option value="_sourceUrl">Key: source_url</option>
          </select>
          <button
            type="button"
            disabled={rows.length < 2}
            onClick={handleDedupeClick}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#1A1D23] px-2.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Layers className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
            <span>Dedupe</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading && rows.length === 0 ? (
        <div className="p-5 space-y-2.5" aria-label="Loading extracted rows" data-testid="results-skeleton">
          <div className="h-8 w-full rounded bg-white/[0.04] animate-pulse" />
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="grid grid-cols-5 gap-3">
              <div className="h-9 rounded bg-white/[0.04] animate-pulse col-span-2" />
              <div className="h-9 rounded bg-white/[0.04] animate-pulse" />
              <div className="h-9 rounded bg-white/[0.04] animate-pulse" />
              <div className="h-9 rounded bg-white/[0.04] animate-pulse" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1A1D23] text-[#9CA3AF]">
            <Table2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-sm font-medium text-[#F3F4F6]">No extracted records yet</h3>
            <p className="text-xs leading-relaxed text-[#9CA3AF]">
              Paste up to 10 public URLs (or a search topic), define fields and optional CSS/table/JS
              rules, then press <span className="font-medium text-[#D1D5DB]">Run Extraction</span> (or{' '}
              <kbd className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-[#D1D5DB]">
                Ctrl/Cmd+Enter
              </kbd>
              ).
            </p>
          </div>
          {onLoadStarterPreset && (
            <button
              type="button"
              onClick={onLoadStarterPreset}
              className="mt-1 rounded-md border border-white/[0.1] bg-[#1A1D23] px-3.5 py-2 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] transition-colors"
            >
              Fill Bookstore Example
            </button>
          )}
        </div>
      ) : viewMode === 'json' ? (
        <div className="p-4">
          <pre
            data-testid="raw-json-output"
            className="max-h-[560px] overflow-auto rounded-md border border-white/[0.08] bg-[#0B0C0E] p-4 font-mono text-xs leading-relaxed text-[#D1D5DB]"
          >
            {rawJsonString}
          </pre>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="px-6 py-12 text-center text-xs text-[#9CA3AF]">
          No rows match your current filter. Clear the search box or confidence filter to see all {rows.length} rows.
        </div>
      ) : (
        <>
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#0F1115] text-[#9CA3AF]">
                {fields.map((field) => (
                  <th
                    key={field.id}
                    scope="col"
                    className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                      field.type === 'number' ? 'text-right' : 'text-left'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(field.name)}
                      className={`inline-flex items-center gap-1.5 hover:text-[#F3F4F6] transition-colors ${
                        field.type === 'number' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <span className="font-mono">{field.name}</span>
                      {renderSortIcon(field.name)}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('confidence')}
                    className="inline-flex items-center gap-1.5 hover:text-[#F3F4F6] transition-colors"
                  >
                    <span>Confidence</span>
                    {renderSortIcon('confidence')}
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[200px]">
                  Source Snippet
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('_sourceUrl')}
                    className="inline-flex items-center gap-1.5 hover:text-[#F3F4F6] transition-colors"
                  >
                    <span>Source</span>
                    {renderSortIcon('_sourceUrl')}
                  </button>
                </th>
                <th scope="col" className="relative px-2.5 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredRows.map((row, rowIndex) => {
                const conf = CONFIDENCE_STYLE[row.confidence];
                let shortHost = row._sourceUrl;
                try {
                  shortHost = new URL(row._sourceUrl).hostname.replace(/^www\./, '');
                } catch {
                  // keep raw
                }

                return (
                  <tr
                    key={row._id}
                    className="group hover:bg-white/[0.025] transition-colors align-top"
                  >
                    {fields.map((field) => {
                      const val = row.values[field.name];
                      const isEditing =
                        editingCell?.rowId === row._id && editingCell?.fieldName === field.name;
                      const formatted = formatCellValue(val);

                      return (
                        <td
                          key={field.id}
                          className={`px-3 py-2.5 ${
                            field.type === 'number' ? 'text-right font-mono tabular-nums' : ''
                          } ${field.type === 'date' ? 'font-mono tabular-nums whitespace-nowrap' : ''}`}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              aria-label={`Edit ${field.name} on row ${rowIndex + 1}`}
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={() => commitEdit(field.type)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitEdit(field.type);
                                } else if (e.key === 'Escape') {
                                  setEditingCell(null);
                                }
                              }}
                              className="w-full min-w-[100px] rounded border border-[#3B82F6] bg-[#0B0C0E] px-2 py-1 text-xs text-[#F3F4F6] focus:outline-none"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditing(row, field.name)}
                              title="Click to edit cell"
                              className={`block w-full rounded px-1 -mx-1 py-0.5 text-left hover:bg-white/[0.06] transition-colors ${
                                field.type === 'number' ? 'text-right' : 'text-left'
                              }`}
                            >
                              {val === null || val === undefined || formatted === '' ? (
                                <span className="font-mono text-[#6B7280] italic">null</span>
                              ) : field.type === 'url' ? (
                                <span className="font-mono text-[#93C5FD] break-all line-clamp-1">
                                  {formatted}
                                </span>
                              ) : (
                                <span className="text-[#E6E8EC]">{formatted}</span>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`font-medium ${conf.textClass}`}>{conf.label}</span>
                      {row._edited && (
                        <span className="ml-1.5 text-[11px] text-[#9CA3AF]">(edited)</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 max-w-[260px]">
                      <p className="text-[#9CA3AF] leading-relaxed line-clamp-2" title={row.source_snippet}>
                        &ldquo;{row.source_snippet}&rdquo;
                      </p>
                      {row.notes && (
                        <p className="mt-1 text-[11px] text-[#6B7280]">{row.notes}</p>
                      )}
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <a
                        href={row._sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={row._sourceUrl}
                        className="inline-flex items-center gap-1 font-mono text-[#9CA3AF] hover:text-[#60A5FA] transition-colors"
                      >
                        <span className="max-w-[120px] truncate">{shortHost}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    </td>

                    <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        aria-label={`Delete row ${rowIndex + 1}`}
                        onClick={() => onDeleteRow(row._id)}
                        className="rounded p-1 text-[#6B7280] hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="border-t border-white/[0.06] bg-[#0F1115] px-4 py-2 text-[11px] text-[#6B7280] rounded-b-lg">
            Tip: Click any extracted cell to edit inline. Press Enter to save or Esc to cancel.
          </div>
        </>
      )}
    </section>
  );
}
