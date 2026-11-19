import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  RotateCw,
  Search,
} from 'lucide-react';
import type { ExtractionMethod, UrlExtractionTask, UrlTaskStatus } from '../types';

interface ExtractionQueueProps {
  tasks: UrlExtractionTask[];
  isDiscovering: boolean;
  discoveredPages: Array<{ url: string; title: string }>;
  isRunning: boolean;
  onRetryTask: (taskId: string) => void;
  onReauthTask: (task: UrlExtractionTask) => void;
}

const STATUS_META: Record<UrlTaskStatus, { label: string; colorClass: string }> = {
  queued: { label: 'Queued', colorClass: 'text-[#9CA3AF]' },
  fetching: { label: 'Fetching', colorClass: 'text-[#60A5FA]' },
  extracting: { label: 'Extracting', colorClass: 'text-amber-400' },
  done: { label: 'Done', colorClass: 'text-emerald-400' },
  failed: { label: 'Failed', colorClass: 'text-rose-400' },
  auth_required: { label: 'Re-auth Required', colorClass: 'text-amber-400' },
};

const METHOD_LABEL: Record<ExtractionMethod, string> = {
  url_context: 'URL Context',
  google_search: 'Search Fallback',
  dom_rules: 'DOM Rules',
  authenticated_fetch: 'Auth Session',
};

function StatusIcon({ status }: { status: UrlTaskStatus }) {
  switch (status) {
    case 'queued':
      return <Clock className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />;
    case 'fetching':
      return <Loader2 className="h-3.5 w-3.5 text-[#60A5FA] animate-spin shrink-0" aria-hidden="true" />;
    case 'extracting':
      return <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" aria-hidden="true" />;
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />;
    case 'auth_required':
      return <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" aria-hidden="true" />;
  }
}

function MethodIcon({ method }: { method: ExtractionMethod }) {
  switch (method) {
    case 'google_search':
      return <Search className="h-3 w-3" aria-hidden="true" />;
    case 'dom_rules':
      return <Code2 className="h-3 w-3" aria-hidden="true" />;
    case 'authenticated_fetch':
      return <KeyRound className="h-3 w-3" aria-hidden="true" />;
    case 'url_context':
    default:
      return <Globe className="h-3 w-3" aria-hidden="true" />;
  }
}

export function ExtractionQueue({
  tasks,
  isDiscovering,
  discoveredPages,
  isRunning,
  onRetryTask,
  onReauthTask,
}: ExtractionQueueProps) {
  if (!isDiscovering && tasks.length === 0) {
    return null;
  }

  const completedCount = tasks.filter(
    (t) => t.status === 'done' || t.status === 'failed' || t.status === 'auth_required'
  ).length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const authCount = tasks.filter((t) => t.status === 'auth_required').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const activeCount = tasks.filter((t) => t.status === 'fetching' || t.status === 'extracting').length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <section
      aria-label="Extraction progress queue"
      className="min-w-0 overflow-hidden rounded-lg border border-white/[0.08] bg-[#131519] p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-[#F3F4F6]">
            {isDiscovering ? 'Discovering Reputable Sources' : 'Extraction Queue'}
          </h2>
          <p className="text-xs text-[#9CA3AF] tabular-nums">
            {isDiscovering ? (
              'Running Google Search grounding to find 3–5 public pages…'
            ) : (
              <>
                {completedCount} of {tasks.length} processed
                <span aria-hidden="true"> · </span>
                {doneCount} succeeded
                {authCount > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="text-amber-400">{authCount} need re-auth</span>
                  </>
                )}
                {failedCount > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="text-rose-400">{failedCount} failed</span>
                  </>
                )}
                {activeCount > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="text-[#60A5FA]">{activeCount} active (max 3 concurrent)</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <span className="font-mono text-xs font-medium text-[#E6E8EC] tabular-nums">
          {isDiscovering ? 'Searching…' : `${progressPct}%`}
        </span>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={isDiscovering ? 15 : progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Extraction progress"
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            failedCount > 0 && completedCount === tasks.length && doneCount === 0
              ? 'bg-rose-500'
              : authCount > 0 && doneCount === 0
                ? 'bg-amber-500'
                : 'bg-[#3B82F6]'
          } ${isDiscovering ? 'w-1/3 animate-pulse' : ''}`}
          style={isDiscovering ? undefined : { width: `${progressPct}%` }}
        />
      </div>

      {discoveredPages.length > 0 && (
        <div className="rounded-md border border-white/[0.06] bg-[#0B0C0E] px-3 py-2 text-xs text-[#9CA3AF]">
          <span className="font-medium text-[#D1D5DB]">Discovered via Google Search: </span>
          {discoveredPages.map((p, idx) => (
            <span key={p.url}>
              {idx > 0 ? ', ' : ''}
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#93C5FD] hover:underline"
              >
                {p.title}
              </a>
            </span>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {tasks.map((task) => {
            const meta = STATUS_META[task.status];
            return (
              <li
                key={task.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon status={task.status} />
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={task.url}
                      className="truncate font-mono text-[#E6E8EC] hover:text-[#60A5FA] transition-colors"
                    >
                      {task.url}
                    </a>
                    <ExternalLink className="h-3 w-3 shrink-0 text-[#6B7280]" aria-hidden="true" />
                  </div>
                  {task.error && (
                    <p
                      className={`pl-5 leading-snug ${
                        task.status === 'auth_required' ? 'text-amber-300' : 'text-rose-400'
                      }`}
                    >
                      {task.error}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pl-5 sm:pl-0 shrink-0 tabular-nums">
                  {task.method && (
                    <span className="inline-flex items-center gap-1 text-[#9CA3AF]">
                      <MethodIcon method={task.method} />
                      <span>{METHOD_LABEL[task.method]}</span>
                    </span>
                  )}

                  {task.status === 'done' && (
                    <span className="text-[#9CA3AF]">
                      {task.rowCount} row{task.rowCount === 1 ? '' : 's'}
                    </span>
                  )}

                  <span className={`font-medium ${meta.colorClass}`}>{meta.label}</span>

                  {task.status === 'auth_required' && (
                    <button
                      type="button"
                      disabled={isRunning}
                      aria-label={`Re-authenticate ${task.url}`}
                      onClick={() => onReauthTask(task)}
                      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-40 transition-colors whitespace-nowrap"
                    >
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      <span>Re-authenticate</span>
                    </button>
                  )}

                  {(task.status === 'failed' || task.status === 'done') && (
                    <>
                      <button
                        type="button"
                        disabled={isRunning}
                        aria-label={`Configure session auth for ${task.url}`}
                        onClick={() => onReauthTask(task)}
                        className="inline-flex items-center gap-1 rounded border border-white/[0.09] bg-[#1A1D23] px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:bg-[#232730] hover:text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        <KeyRound className="h-3 w-3" aria-hidden="true" />
                        <span>Auth</span>
                      </button>
                      <button
                        type="button"
                        disabled={isRunning}
                        aria-label={`Retry ${task.url}`}
                        onClick={() => onRetryTask(task.id)}
                        className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-[#1A1D23] px-2 py-1 text-[11px] font-medium text-[#D1D5DB] hover:bg-[#232730] hover:text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        <RotateCw className="h-3 w-3" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
