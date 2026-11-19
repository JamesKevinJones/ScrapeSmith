import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtractionQueue } from './components/ExtractionQueue';
import { GoogleSheetsModal } from './components/GoogleSheetsModal';
import { HistoryView } from './components/HistoryView';
import { InputPanel } from './components/InputPanel';
import { ReauthModal } from './components/ReauthModal';
import { ResultsView } from './components/ResultsView';
import { SchemaPanel } from './components/SchemaPanel';
import { ToastContainer } from './components/ToastContainer';
import { TopBar } from './components/TopBar';
import { useExtractionEngine } from './hooks/useExtractionEngine';
import { useToasts } from './hooks/useToasts';
import { generateSchemaApi } from './services/gemini';
import type {
  ActiveTab,
  ExtractionMode,
  FieldDefinition,
  FieldExtractionRule,
  FieldType,
  HistoryRun,
  TemporarySession,
  UrlExtractionTask,
} from './types';
import {
  clearHistory,
  deleteHistoryRun,
  loadHistory,
  saveHistoryRun,
} from './utils/historyStorage';
import { checkPiiViolation } from './utils/piiGuard';
import { EXTRACTION_PRESETS, type ExtractionPreset } from './utils/presets';
import {
  fieldsToJsonSchema,
  parseFreeTextToFields,
  parseJsonSchemaText,
} from './utils/schemaBuilder';
import { hydrateTabSessions } from './utils/sessionStore';
import { parseTargetInput } from './utils/urlParser';

const DEFAULT_FIELDS_TEXT = 'product name, price, rating, review count';
const DEFAULT_FIELDS = parseFreeTextToFields(DEFAULT_FIELDS_TEXT);
const DEFAULT_MODE: ExtractionMode = 'list';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('workbench');
  const [urlsText, setUrlsText] = useState('');
  const [fieldsText, setFieldsText] = useState(DEFAULT_FIELDS_TEXT);
  const [fields, setFields] = useState<FieldDefinition[]>(DEFAULT_FIELDS);
  const [mode, setMode] = useState<ExtractionMode>(DEFAULT_MODE);
  const [schemaText, setSchemaText] = useState(() =>
    JSON.stringify(fieldsToJsonSchema(DEFAULT_FIELDS, DEFAULT_MODE), null, 2)
  );
  const [isSchemaDirty, setIsSchemaDirty] = useState(false);
  const [isGeneratingSchema, setIsGeneratingSchema] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>(() => loadHistory());

  // Re-authentication modal state
  const [activeSessions, setActiveSessions] = useState<TemporarySession[]>(() => hydrateTabSessions());
  const [reauthContext, setReauthContext] = useState<{
    isOpen: boolean;
    targetUrl: string | null;
    targetTaskId: string | null;
    authHint?: string | null;
  }>({ isOpen: false, targetUrl: null, targetTaskId: null, authHint: null });

  // Google Sheets export modal state
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);

  const { toasts, pushToast, dismissToast } = useToasts();
  const engine = useExtractionEngine();

  const parsedTargets = useMemo(() => parseTargetInput(urlsText), [urlsText]);
  const parsedSchema = useMemo(() => parseJsonSchemaText(schemaText), [schemaText]);
  const piiCheck = useMemo(
    () => checkPiiViolation(fieldsText, fields, schemaText),
    [fieldsText, fields, schemaText]
  );

  const rebuildSchema = useCallback(
    (nextFields: FieldDefinition[], nextMode: ExtractionMode) => {
      const generated = fieldsToJsonSchema(nextFields, nextMode);
      setSchemaText(JSON.stringify(generated, null, 2));
      setIsSchemaDirty(false);
    },
    []
  );

  const handleApplyFieldsText = useCallback(() => {
    const parsed = parseFreeTextToFields(fieldsText);
    if (parsed.length === 0) return;
    // Preserve existing per-field advanced rules for fields that remain
    const existingRules = new Map(fields.map((f) => [f.name, f.rules]));
    const merged = parsed.map((f) => ({
      ...f,
      ...(existingRules.get(f.name) ? { rules: existingRules.get(f.name) } : {}),
    }));
    setFields(merged);
    rebuildSchema(merged, mode);
  }, [fields, fieldsText, mode, rebuildSchema]);

  const handleAddField = useCallback(
    (name: string, type: FieldType) => {
      setFields((prev) => {
        if (prev.some((f) => f.name === name)) {
          pushToast('info', `Field "${name}" already exists`);
          return prev;
        }
        const next: FieldDefinition[] = [
          ...prev,
          { id: `field_${name}`, name, type, description: name.replace(/_/g, ' ') },
        ];
        setFieldsText(next.map((f) => f.name).join(', '));
        rebuildSchema(next, mode);
        return next;
      });
    },
    [mode, pushToast, rebuildSchema]
  );

  const handleUpdateFieldType = useCallback(
    (id: string, type: FieldType) => {
      setFields((prev) => {
        const next = prev.map((f) => (f.id === id ? { ...f, type } : f));
        rebuildSchema(next, mode);
        return next;
      });
    },
    [mode, rebuildSchema]
  );

  const handleUpdateFieldRules = useCallback(
    (id: string, rules: FieldExtractionRule | undefined) => {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, rules } : f)));
    },
    []
  );

  const handleRemoveField = useCallback(
    (id: string) => {
      setFields((prev) => {
        const next = prev.filter((f) => f.id !== id);
        setFieldsText(next.map((f) => f.name).join(', '));
        rebuildSchema(next, mode);
        return next;
      });
    },
    [mode, rebuildSchema]
  );

  const handleModeChange = useCallback(
    (nextMode: ExtractionMode) => {
      setMode(nextMode);
      rebuildSchema(fields, nextMode);
    },
    [fields, rebuildSchema]
  );

  const handleSchemaTextChange = useCallback((value: string) => {
    setSchemaText(value);
    setIsSchemaDirty(true);
  }, []);

  const handleSyncSchemaToFields = useCallback(() => {
    const check = parseJsonSchemaText(schemaText);
    if (!check.valid || !check.fields) {
      pushToast('error', 'Cannot sync invalid schema', check.error);
      return;
    }
    const existingRules = new Map(fields.map((f) => [f.name, f.rules]));
    const merged = check.fields.map((f) => ({
      ...f,
      ...(existingRules.get(f.name) ? { rules: existingRules.get(f.name) } : {}),
    }));
    setFields(merged);
    setFieldsText(merged.map((f) => f.name).join(', '));
    if (check.mode) setMode(check.mode);
    setIsSchemaDirty(false);
    pushToast('success', 'Fields synced from schema', `${merged.length} field(s) updated.`);
  }, [fields, pushToast, schemaText]);

  const handleResetSchemaFromFields = useCallback(() => {
    rebuildSchema(fields, mode);
    pushToast('info', 'Schema reset', 'Rebuilt JSON Schema from current field chips.');
  }, [fields, mode, pushToast, rebuildSchema]);

  const handleFormatSchema = useCallback(() => {
    try {
      const formatted = JSON.stringify(JSON.parse(schemaText), null, 2);
      setSchemaText(formatted);
    } catch {
      pushToast('error', 'Invalid JSON', 'Fix JSON syntax errors before formatting.');
    }
  }, [pushToast, schemaText]);

  const handleGenerateSchemaAi = useCallback(async () => {
    if (piiCheck.blocked) {
      pushToast('error', 'Privacy Policy Restriction', piiCheck.message);
      return;
    }
    setIsGeneratingSchema(true);
    try {
      const res = await generateSchemaApi({ fieldsText, fields, mode });
      setFields(res.fields);
      setFieldsText(res.fields.map((f) => f.name).join(', '));
      setSchemaText(JSON.stringify(res.schema, null, 2));
      setIsSchemaDirty(false);
      pushToast(
        'success',
        'Schema generated',
        `${res.fields.length} typed field(s) ready${res.repaired ? ' (auto-repaired JSON)' : ''}.`
      );
    } catch (err) {
      pushToast(
        'error',
        'Schema generation failed',
        err instanceof Error ? err.message : 'Unable to generate schema.'
      );
    } finally {
      setIsGeneratingSchema(false);
    }
  }, [fields, fieldsText, mode, piiCheck.blocked, piiCheck.message, pushToast]);

  const handleApplyPreset = useCallback(
    (preset: ExtractionPreset) => {
      setUrlsText(preset.urlsText);
      setFieldsText(preset.fieldsText);
      setFields(preset.fields);
      setMode(preset.mode);
      rebuildSchema(preset.fields, preset.mode);
      pushToast('info', `Loaded preset: ${preset.label}`, 'Press Ctrl/Cmd+Enter or Run Extraction to start.');
    },
    [pushToast, rebuildSchema]
  );

  const canRun =
    !engine.isRunning &&
    !piiCheck.blocked &&
    parsedSchema.valid &&
    fields.length > 0 &&
    (parsedTargets.validUrls.length > 0 || Boolean(parsedTargets.topicQuery));

  const handleRunExtraction = useCallback(() => {
    if (engine.isRunning) return;

    if (piiCheck.blocked) {
      pushToast('error', 'Personal Data Extraction Blocked', piiCheck.message);
      return;
    }

    if (
      parsedTargets.inputKind === 'empty' ||
      (parsedTargets.validUrls.length === 0 && !parsedTargets.topicQuery)
    ) {
      pushToast('error', 'No valid targets', 'Paste at least one valid public HTTP(S) URL or enter a search topic.');
      return;
    }

    const existingRules = new Map(fields.map((f) => [f.name, f.rules]));
    const activeFields =
      isSchemaDirty && parsedSchema.valid && parsedSchema.fields
        ? parsedSchema.fields.map((f) => ({
            ...f,
            ...(existingRules.get(f.name) ? { rules: existingRules.get(f.name) } : {}),
          }))
        : fields.length > 0
          ? fields
          : parseFreeTextToFields(fieldsText);

    if (activeFields.length === 0) {
      pushToast('error', 'No extraction fields', 'Specify at least one field to extract.');
      return;
    }

    if (!parsedSchema.valid || !parsedSchema.schema) {
      pushToast('error', 'Invalid JSON Schema', parsedSchema.error ?? 'Fix schema syntax before running.');
      return;
    }

    if (isSchemaDirty && parsedSchema.fields) {
      setFields(activeFields);
      setIsSchemaDirty(false);
    }

    if (activeTab === 'history' || activeTab === 'schema') {
      setActiveTab('workbench');
    }

    void engine.runExtraction({
      urls: parsedTargets.validUrls,
      topicQuery: parsedTargets.topicQuery,
      fieldsText,
      fields: activeFields,
      mode: parsedSchema.mode ?? mode,
      schema: parsedSchema.schema,
      schemaText,
      onRunFinished: (run) => {
        const updated = saveHistoryRun(run);
        setHistoryRuns(updated);
      },
      onNotify: pushToast,
    });
  }, [
    activeTab,
    engine,
    fields,
    fieldsText,
    isSchemaDirty,
    mode,
    parsedSchema,
    parsedTargets,
    piiCheck.blocked,
    piiCheck.message,
    pushToast,
    schemaText,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (reauthContext.isOpen || isSheetsModalOpen) return;
        e.preventDefault();
        handleRunExtraction();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRunExtraction, isSheetsModalOpen, reauthContext.isOpen]);

  const handleRetryTask = useCallback(
    (taskId: string) => {
      if (!parsedSchema.valid || !parsedSchema.schema) {
        pushToast('error', 'Invalid JSON Schema', parsedSchema.error);
        return;
      }
      void engine.retryTask(taskId, mode, fields, parsedSchema.schema, pushToast);
    },
    [engine, fields, mode, parsedSchema, pushToast]
  );

  const handleOpenReauthForTask = useCallback((task: UrlExtractionTask) => {
    setReauthContext({
      isOpen: true,
      targetUrl: task.url,
      targetTaskId: task.id,
      authHint: task.authHint ?? task.error ?? null,
    });
  }, []);

  const handleOpenGeneralReauth = useCallback(() => {
    setReauthContext({
      isOpen: true,
      targetUrl: parsedTargets.validUrls[0] ?? null,
      targetTaskId: null,
      authHint: null,
    });
  }, [parsedTargets.validUrls]);

  const handleLoadHistoryRun = useCallback(
    (run: HistoryRun) => {
      setUrlsText(run.topicQuery ? run.topicQuery : run.urls.join('\n'));
      setFieldsText(run.fieldsText);
      setFields(run.fields);
      setMode(run.mode);
      setSchemaText(run.schemaText);
      setIsSchemaDirty(false);
      engine.loadSnapshot(run.tasks, run.rows, run.createdAt);
      setActiveTab('workbench');
      pushToast('info', 'Loaded saved run', `${run.rows.length} row(s) restored from history.`);
    },
    [engine, pushToast]
  );

  const handleRerunHistory = useCallback(
    (run: HistoryRun) => {
      const check = parseJsonSchemaText(run.schemaText);
      const schema = check.valid && check.schema ? check.schema : fieldsToJsonSchema(run.fields, run.mode);
      const pii = checkPiiViolation(run.fieldsText, run.fields, run.schemaText);
      if (pii.blocked) {
        pushToast('error', 'Personal Data Extraction Blocked', pii.message);
        return;
      }

      setUrlsText(run.topicQuery ? run.topicQuery : run.urls.join('\n'));
      setFieldsText(run.fieldsText);
      setFields(run.fields);
      setMode(run.mode);
      setSchemaText(JSON.stringify(schema, null, 2));
      setIsSchemaDirty(false);
      setActiveTab('workbench');

      void engine.runExtraction({
        urls: run.topicQuery ? [] : run.urls,
        topicQuery: run.topicQuery ?? null,
        fieldsText: run.fieldsText,
        fields: run.fields,
        mode: run.mode,
        schema,
        schemaText: JSON.stringify(schema, null, 2),
        onRunFinished: (newRun) => {
          setHistoryRuns(saveHistoryRun(newRun));
        },
        onNotify: pushToast,
      });
    },
    [engine, pushToast]
  );

  const handleDeleteHistory = useCallback(
    (id: string) => {
      setHistoryRuns(deleteHistoryRun(id));
      pushToast('info', 'History entry deleted');
    },
    [pushToast]
  );

  const handleClearHistory = useCallback(() => {
    clearHistory();
    setHistoryRuns([]);
    pushToast('info', 'History cleared');
  }, [pushToast]);

  const activeSourceUrls = useMemo(() => {
    if (engine.tasks.length > 0) return engine.tasks.map((t) => t.url);
    return parsedTargets.validUrls;
  }, [engine.tasks, parsedTargets.validUrls]);

  return (
    <div className="min-h-screen bg-[#0B0C0E] text-[#E6E8EC] flex flex-col">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        rowCount={engine.rows.length}
        historyCount={historyRuns.length}
        isRunning={engine.isRunning}
        canRun={canRun}
        onRun={handleRunExtraction}
        onCancel={engine.cancelExtraction}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
        {activeTab === 'workbench' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[440px_minmax(0,1fr)] items-start">
            <div className="space-y-6 min-w-0">
              <InputPanel
                urlsText={urlsText}
                onUrlsTextChange={setUrlsText}
                parsedTargets={parsedTargets}
                fieldsText={fieldsText}
                onFieldsTextChange={setFieldsText}
                onApplyFieldsText={handleApplyFieldsText}
                fields={fields}
                onAddField={handleAddField}
                onUpdateFieldType={handleUpdateFieldType}
                onUpdateFieldRules={handleUpdateFieldRules}
                onRemoveField={handleRemoveField}
                mode={mode}
                onModeChange={handleModeChange}
                piiCheck={piiCheck}
                isGeneratingSchema={isGeneratingSchema}
                onGenerateSchemaAi={handleGenerateSchemaAi}
                onApplyPreset={handleApplyPreset}
                activeSessionCount={activeSessions.length}
                onOpenReauth={handleOpenGeneralReauth}
              />

              <SchemaPanel
                schemaText={schemaText}
                onSchemaTextChange={handleSchemaTextChange}
                schemaError={parsedSchema.valid ? null : parsedSchema.error ?? 'Invalid schema'}
                isDirty={isSchemaDirty}
                isGeneratingSchema={isGeneratingSchema}
                onSyncSchemaToFields={handleSyncSchemaToFields}
                onResetSchemaFromFields={handleResetSchemaFromFields}
                onFormatSchema={handleFormatSchema}
                onGenerateSchemaAi={handleGenerateSchemaAi}
                piiBlocked={piiCheck.blocked}
              />
            </div>

            <div className="space-y-6 min-w-0">
              <ExtractionQueue
                tasks={engine.tasks}
                isDiscovering={engine.isDiscovering}
                discoveredPages={engine.discoveredPages}
                isRunning={engine.isRunning}
                onRetryTask={handleRetryTask}
                onReauthTask={handleOpenReauthForTask}
              />

              <ResultsView
                rows={engine.rows}
                fields={fields}
                sourceUrls={activeSourceUrls}
                lastExtractedAt={engine.lastExtractedAt}
                isLoading={engine.isRunning}
                onEditCell={engine.editCell}
                onDeleteRow={engine.deleteRow}
                onDedupe={engine.applyDedupe}
                onNotify={pushToast}
                onOpenGoogleSheets={() => setIsSheetsModalOpen(true)}
                onLoadStarterPreset={() => handleApplyPreset(EXTRACTION_PRESETS[0])}
              />
            </div>
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="mx-auto max-w-4xl space-y-6">
            <SchemaPanel
              schemaText={schemaText}
              onSchemaTextChange={handleSchemaTextChange}
              schemaError={parsedSchema.valid ? null : parsedSchema.error ?? 'Invalid schema'}
              isDirty={isSchemaDirty}
              isGeneratingSchema={isGeneratingSchema}
              onSyncSchemaToFields={handleSyncSchemaToFields}
              onResetSchemaFromFields={handleResetSchemaFromFields}
              onFormatSchema={handleFormatSchema}
              onGenerateSchemaAi={handleGenerateSchemaAi}
              piiBlocked={piiCheck.blocked}
              expanded
            />
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-6">
            <ExtractionQueue
              tasks={engine.tasks}
              isDiscovering={engine.isDiscovering}
              discoveredPages={engine.discoveredPages}
              isRunning={engine.isRunning}
              onRetryTask={handleRetryTask}
              onReauthTask={handleOpenReauthForTask}
            />
            <ResultsView
              rows={engine.rows}
              fields={fields}
              sourceUrls={activeSourceUrls}
              lastExtractedAt={engine.lastExtractedAt}
              isLoading={engine.isRunning}
              onEditCell={engine.editCell}
              onDeleteRow={engine.deleteRow}
              onDedupe={engine.applyDedupe}
              onNotify={pushToast}
              onOpenGoogleSheets={() => setIsSheetsModalOpen(true)}
              onLoadStarterPreset={() => {
                handleApplyPreset(EXTRACTION_PRESETS[0]);
                setActiveTab('workbench');
              }}
            />
          </div>
        )}

        {activeTab === 'history' && (
          <div className="mx-auto max-w-5xl">
            <HistoryView
              runs={historyRuns}
              onLoadRun={handleLoadHistoryRun}
              onRerun={handleRerunHistory}
              onDeleteRun={handleDeleteHistory}
              onClearAll={handleClearHistory}
            />
          </div>
        )}
      </main>

      <ReauthModal
        isOpen={reauthContext.isOpen}
        targetUrl={reauthContext.targetUrl}
        targetTaskId={reauthContext.targetTaskId}
        authHint={reauthContext.authHint}
        onClose={() =>
          setReauthContext({ isOpen: false, targetUrl: null, targetTaskId: null, authHint: null })
        }
        onSessionsChanged={setActiveSessions}
        onRetryAfterAuth={handleRetryTask}
        onNotify={pushToast}
      />

      <GoogleSheetsModal
        isOpen={isSheetsModalOpen}
        onClose={() => setIsSheetsModalOpen(false)}
        fields={fields}
        rows={engine.rows}
        onNotify={pushToast}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
