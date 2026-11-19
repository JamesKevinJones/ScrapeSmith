import { useCallback, useRef, useState } from 'react';
import { discoverUrlsApi, extractUrlApi, GeminiServiceError } from '../services/gemini';
import type {
  CellValue,
  ExtractedRow,
  ExtractionMode,
  FieldDefinition,
  HistoryRun,
  JsonSchema,
  UrlExtractionTask,
} from '../types';
import { dedupeRows, runWithConcurrency } from '../utils/dataTransforms';
import { getSessionHeaderForUrl } from '../utils/sessionStore';

const CONCURRENCY_LIMIT = 3;

interface RunExtractionParams {
  urls: string[];
  topicQuery: string | null;
  fieldsText: string;
  fields: FieldDefinition[];
  mode: ExtractionMode;
  schema: JsonSchema;
  schemaText: string;
  onRunFinished?: (run: HistoryRun) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function useExtractionEngine() {
  const [tasks, setTasks] = useState<UrlExtractionTask[]>([]);
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredPages, setDiscoveredPages] = useState<Array<{ url: string; title: string }>>([]);
  const [lastExtractedAt, setLastExtractedAt] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const tasksRef = useRef<UrlExtractionTask[]>([]);
  const rowsRef = useRef<ExtractedRow[]>([]);

  // Update refs synchronously so post-Promise reads always see the latest state
  const updateTasks = useCallback((updater: (prev: UrlExtractionTask[]) => UrlExtractionTask[]) => {
    const next = updater(tasksRef.current);
    tasksRef.current = next;
    setTasks(next);
  }, []);

  const updateRows = useCallback((updater: (prev: ExtractedRow[]) => ExtractedRow[]) => {
    const next = updater(rowsRef.current);
    rowsRef.current = next;
    setRows(next);
  }, []);

  const processSingleUrl = useCallback(
    async (
      taskId: string,
      url: string,
      mode: ExtractionMode,
      fields: FieldDefinition[],
      schema: JsonSchema,
      signal: AbortSignal
    ): Promise<{ task: UrlExtractionTask; rows: ExtractedRow[] }> => {
      const startedAt = new Date().toISOString();
      const sessionAuth = getSessionHeaderForUrl(url);

      updateTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'fetching',
                error: undefined,
                authRequired: false,
                authHint: undefined,
                startedAt,
              }
            : t
        )
      );

      const stageTimer = setTimeout(() => {
        updateTasks((prev) =>
          prev.map((t) =>
            t.id === taskId && t.status === 'fetching' ? { ...t, status: 'extracting' } : t
          )
        );
      }, 900);

      try {
        const result = await extractUrlApi(
          { url, mode, fields, schema, allowSearchFallback: true, sessionAuth },
          signal
        );
        clearTimeout(stageTimer);

        const completedAt = new Date().toISOString();

        if (result.authRequired && result.rows.length === 0) {
          const authTask: UrlExtractionTask = {
            id: taskId,
            url,
            status: 'auth_required',
            method: result.method,
            rowCount: 0,
            error: result.failedReason ?? 'Authentication or re-login required to access this page.',
            authRequired: true,
            authHint: result.authHint ?? result.failedReason ?? undefined,
            startedAt,
            completedAt,
            repaired: result.repaired,
          };
          updateTasks((prev) => prev.map((t) => (t.id === taskId ? authTask : t)));
          return { task: authTask, rows: [] };
        }

        if (result.failedReason && result.rows.length === 0) {
          const failedTask: UrlExtractionTask = {
            id: taskId,
            url,
            status: 'failed',
            method: result.method,
            rowCount: 0,
            error: result.failedReason,
            startedAt,
            completedAt,
            repaired: result.repaired,
          };
          updateTasks((prev) => prev.map((t) => (t.id === taskId ? failedTask : t)));
          return { task: failedTask, rows: [] };
        }

        const doneTask: UrlExtractionTask = {
          id: taskId,
          url,
          status: 'done',
          method: result.method,
          rowCount: result.rows.length,
          startedAt,
          completedAt,
          repaired: result.repaired,
        };
        updateTasks((prev) => prev.map((t) => (t.id === taskId ? doneTask : t)));
        updateRows((prev) => [...prev.filter((r) => r._sourceUrl !== url), ...result.rows]);
        return { task: doneTask, rows: result.rows };
      } catch (err) {
        clearTimeout(stageTimer);
        const completedAt = new Date().toISOString();
        const errorMsg =
          err instanceof GeminiServiceError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Extraction failed.';

        const failedTask: UrlExtractionTask = {
          id: taskId,
          url,
          status: 'failed',
          rowCount: 0,
          error: errorMsg,
          startedAt,
          completedAt,
        };
        updateTasks((prev) => prev.map((t) => (t.id === taskId ? failedTask : t)));
        return { task: failedTask, rows: [] };
      }
    },
    [updateRows, updateTasks]
  );

  const runExtraction = useCallback(
    async (params: RunExtractionParams) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setDiscoveredPages([]);
      updateRows(() => []);

      let targetUrls = params.urls;

      try {
        if (params.topicQuery && targetUrls.length === 0) {
          setIsDiscovering(true);
          params.onNotify('info', 'Searching reputable sources', `Finding 3–5 pages for "${params.topicQuery}"`);
          const discovered = await discoverUrlsApi(
            { topic: params.topicQuery, fieldsText: params.fieldsText },
            controller.signal
          );
          setDiscoveredPages(discovered.urls);
          targetUrls = discovered.urls.map((u) => u.url);
          setIsDiscovering(false);
        }

        const initialTasks: UrlExtractionTask[] = targetUrls.map((url, idx) => ({
          id: `task_${Date.now()}_${idx}`,
          url,
          status: 'queued',
          rowCount: 0,
        }));
        updateTasks(() => initialTasks);

        await runWithConcurrency(initialTasks, CONCURRENCY_LIMIT, async (task) => {
          if (controller.signal.aborted) return;
          await processSingleUrl(
            task.id,
            task.url,
            params.mode,
            params.fields,
            params.schema,
            controller.signal
          );
        });

        const finishedAt = new Date().toISOString();
        setLastExtractedAt(finishedAt);

        const finalTasks = tasksRef.current;
        const finalRows = rowsRef.current;
        const doneCount = finalTasks.filter((t) => t.status === 'done').length;
        const authCount = finalTasks.filter((t) => t.status === 'auth_required').length;
        const failCount = finalTasks.filter((t) => t.status === 'failed').length;

        if (!controller.signal.aborted) {
          if (finalRows.length > 0) {
            const notes: string[] = [`${doneCount} of ${finalTasks.length} URL${finalTasks.length === 1 ? '' : 's'} succeeded`];
            if (authCount > 0) notes.push(`${authCount} require re-auth`);
            if (failCount > 0) notes.push(`${failCount} failed`);
            params.onNotify(
              'success',
              `Extracted ${finalRows.length} row${finalRows.length === 1 ? '' : 's'}`,
              notes.join(' · ')
            );
          } else if (authCount > 0) {
            params.onNotify(
              'info',
              'Re-authentication required',
              `${authCount} URL${authCount === 1 ? '' : 's'} returned a login prompt. Use Re-authenticate in the queue to continue.`
            );
          } else if (failCount > 0) {
            params.onNotify(
              'error',
              'Extraction completed with errors',
              finalTasks.find((t) => t.error)?.error ?? 'All target URLs failed.'
            );
          } else {
            params.onNotify('info', 'No matching items found', 'Pages loaded cleanly, but none matched the requested fields.');
          }

          if (params.onRunFinished) {
            params.onRunFinished({
              id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              createdAt: finishedAt,
              urls: targetUrls,
              topicQuery: params.topicQuery,
              fieldsText: params.fieldsText,
              fields: params.fields,
              mode: params.mode,
              schemaText: params.schemaText,
              rows: finalRows,
              tasks: finalTasks,
            });
          }
        }
      } catch (err) {
        setIsDiscovering(false);
        const msg = err instanceof Error ? err.message : 'Extraction failed.';
        if (!(err instanceof GeminiServiceError && err.code === 'ABORTED')) {
          params.onNotify('error', 'Extraction failed', msg);
        }
      } finally {
        setIsDiscovering(false);
        setIsRunning(false);
      }
    },
    [processSingleUrl, updateRows, updateTasks]
  );

  const retryTask = useCallback(
    async (
      taskId: string,
      mode: ExtractionMode,
      fields: FieldDefinition[],
      schema: JsonSchema,
      onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
    ) => {
      const target = tasksRef.current.find((t) => t.id === taskId);
      if (!target) return;

      const controller = new AbortController();
      const result = await processSingleUrl(taskId, target.url, mode, fields, schema, controller.signal);
      setLastExtractedAt(new Date().toISOString());

      if (result.task.status === 'done') {
        onNotify('success', 'Retry succeeded', `Extracted ${result.rows.length} row(s) from ${target.url}`);
      } else if (result.task.status === 'auth_required') {
        onNotify('info', 'Authentication still required', result.task.error ?? 'Provide a refreshed temporary session.');
      } else {
        onNotify('error', 'Retry failed', result.task.error ?? 'Could not extract page.');
      }
    },
    [processSingleUrl]
  );

  const cancelExtraction = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
    setIsDiscovering(false);
  }, []);

  const editCell = useCallback(
    (rowId: string, fieldName: string, newValue: CellValue) => {
      updateRows((prev) =>
        prev.map((row) =>
          row._id === rowId
            ? {
                ...row,
                _edited: true,
                values: { ...row.values, [fieldName]: newValue },
              }
            : row
        )
      );
    },
    [updateRows]
  );

  const deleteRow = useCallback(
    (rowId: string) => {
      updateRows((prev) => prev.filter((r) => r._id !== rowId));
    },
    [updateRows]
  );

  const applyDedupe = useCallback(
    (key: string): number => {
      const result = dedupeRows(rowsRef.current, key);
      updateRows(() => result.rows);
      return result.removedCount;
    },
    [updateRows]
  );

  const loadSnapshot = useCallback(
    (loadedTasks: UrlExtractionTask[], loadedRows: ExtractedRow[], extractedAt: string) => {
      updateTasks(() => loadedTasks);
      updateRows(() => loadedRows);
      setDiscoveredPages([]);
      setLastExtractedAt(extractedAt);
    },
    [updateRows, updateTasks]
  );

  const resetResults = useCallback(() => {
    updateTasks(() => []);
    updateRows(() => []);
    setDiscoveredPages([]);
    setLastExtractedAt(null);
  }, [updateRows, updateTasks]);

  return {
    tasks,
    rows,
    isRunning,
    isDiscovering,
    discoveredPages,
    lastExtractedAt,
    runExtraction,
    retryTask,
    cancelExtraction,
    editCell,
    deleteRow,
    applyDedupe,
    loadSnapshot,
    resetResults,
  };
}
