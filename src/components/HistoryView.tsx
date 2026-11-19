import { Clock, FolderOpen, RotateCw, Trash2 } from 'lucide-react';
import type { HistoryRun } from '../types';

interface HistoryViewProps {
  runs: HistoryRun[];
  onLoadRun: (run: HistoryRun) => void;
  onRerun: (run: HistoryRun) => void;
  onDeleteRun: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryView({
  runs,
  onLoadRun,
  onRerun,
  onDeleteRun,
  onClearAll,
}: HistoryViewProps) {
  return (
    <section
      aria-label="Extraction history"
      className="rounded-lg border border-white/[0.08] bg-[#131519] flex flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-[#F3F4F6]">Run History</h2>
          <p className="text-xs text-[#9CA3AF] tabular-nums">
            {runs.length} saved run{runs.length === 1 ? '' : 's'} stored locally in your browser
          </p>
        </div>

        {runs.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-md border border-white/[0.1] bg-[#1A1D23] px-3 py-1.5 text-xs font-medium text-[#9CA3AF] hover:text-rose-400 hover:border-rose-500/30 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1A1D23] text-[#9CA3AF]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-sm font-medium text-[#F3F4F6]">No saved runs yet</h3>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              Completed extractions are saved automatically so you can inspect previous results,
              export again, or re-run with updated pages.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {runs.map((run) => {
            const title =
              run.topicQuery ||
              (run.urls.length === 1
                ? run.urls[0]
                : `${run.urls[0]} (+${run.urls.length - 1} more)`);
            const formattedDate = new Date(run.createdAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <li
                key={run.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate font-mono text-xs font-medium text-[#F3F4F6]" title={title}>
                    {title}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9CA3AF] tabular-nums">
                    <span>{formattedDate}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {run.urls.length} URL{run.urls.length === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {run.rows.length} row{run.rows.length === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{run.mode === 'list' ? 'List mode' : 'Single item'}</span>
                  </div>
                  <p className="truncate text-xs text-[#6B7280] font-mono">
                    Fields: {run.fields.map((f) => f.name).join(', ')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label={`Open results from ${formattedDate}`}
                    onClick={() => onLoadRun(run)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#1A1D23] px-3 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] transition-colors whitespace-nowrap"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Re-run extraction from ${formattedDate}`}
                    onClick={() => onRerun(run)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3B82F6]/35 bg-[#3B82F6]/15 px-3 text-xs font-medium text-[#93C5FD] hover:bg-[#3B82F6]/25 transition-colors whitespace-nowrap"
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Re-run</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete run from ${formattedDate}`}
                    onClick={() => onDeleteRun(run.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-[#1A1D23] text-[#9CA3AF] hover:border-rose-500/35 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
