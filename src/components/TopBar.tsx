import { Play, Square } from 'lucide-react';
import type { ActiveTab } from '../types';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  rowCount: number;
  historyCount: number;
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'schema', label: 'Schema' },
  { id: 'results', label: 'Results' },
  { id: 'history', label: 'History' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  rowCount,
  historyCount,
  isRunning,
  canRun,
  onRun,
  onCancel,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0B0C0E]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6">
        {/* Zone 1: Brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('workbench')}
          className="text-base font-semibold tracking-tight text-[#F3F4F6] hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] rounded"
        >
          ScrapeSmith
        </button>

        {/* Zone 2: Desktop navigation links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            const suffix =
              item.id === 'results' && rowCount > 0
                ? ` (${rowCount})`
                : item.id === 'history' && historyCount > 0
                  ? ` (${historyCount})`
                  : '';

            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] rounded ${
                  active
                    ? 'text-[#F3F4F6] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#3B82F6]'
                    : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
                }`}
              >
                {item.label}
                {suffix}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/15 px-3.5 text-sm font-medium text-rose-300 hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Stop Run</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              title="Run extraction (Ctrl+Enter / Cmd+Enter)"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#3B82F6] px-4 text-sm font-medium text-white hover:bg-[#2563EB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0C0E]"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Run Extraction</span>
              <kbd className="hidden lg:inline-block rounded bg-white/15 px-1.5 py-0.5 font-mono text-[11px] font-normal text-white/90">
                ⌘↵
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center gap-1 border-t border-white/[0.06] px-4 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          const suffix =
            item.id === 'results' && rowCount > 0
              ? ` (${rowCount})`
              : item.id === 'history' && historyCount > 0
                ? ` (${historyCount})`
                : '';

          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(item.id)}
              className={`relative px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                active
                  ? 'text-[#F3F4F6] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-[#3B82F6]'
                  : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
              }`}
            >
              {item.label}
              {suffix}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
