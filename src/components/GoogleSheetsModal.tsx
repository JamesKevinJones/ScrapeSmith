import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  clearGoogleAccessToken,
  getGoogleAccessToken,
  initGoogleAuth,
  signInWithGoogle,
  signOutGoogle,
} from '../services/googleAuth';
import {
  createNewSpreadsheet,
  exportRowsToGoogleSheet,
  getSpreadsheetWorksheets,
  GoogleSheetsApiError,
  listUserSpreadsheets,
} from '../services/googleSheets';
import type {
  ExtractedRow,
  FieldDefinition,
  GoogleSpreadsheetSummary,
  GoogleWorksheetInfo,
  SheetColumnMapping,
  SheetExportMode,
} from '../types';
import {
  createDefaultSheetMappings,
  extractSpreadsheetId,
  indexToColumnLetter,
} from '../utils/sheetsMapping';

interface GoogleSheetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  fields: FieldDefinition[];
  rows: ExtractedRow[];
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function GoogleSheetsModal({
  isOpen,
  onClose,
  fields,
  rows,
  onNotify,
}: GoogleSheetsModalProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => getGoogleAccessToken());
  const [needsAuth, setNeedsAuth] = useState(!getGoogleAccessToken());
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [spreadsheets, setSpreadsheets] = useState<GoogleSpreadsheetSummary[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState('');
  const [selectedSpreadsheetTitle, setSelectedSpreadsheetTitle] = useState('');
  const [selectedSpreadsheetUrl, setSelectedSpreadsheetUrl] = useState('');
  const [manualIdInput, setManualIdInput] = useState('');

  const [worksheets, setWorksheets] = useState<GoogleWorksheetInfo[]>([]);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const [selectedWorksheet, setSelectedWorksheet] = useState('');

  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState('ScrapeSmith Export');
  const [newTabTitle, setNewTabTitle] = useState('Extracted Data');
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);

  const [columnMappings, setColumnMappings] = useState<SheetColumnMapping[]>([]);
  const [writeMode, setWriteMode] = useState<SheetExportMode>('append');
  const [includeHeaders, setIncludeHeaders] = useState(true);

  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<{
    updatedRows: number;
    updatedRange: string;
    sheetUrl: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      (authedUser) => {
        setUser(authedUser);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return unsubscribe;
  }, []);

  // Refresh default column mappings when modal opens or fields change
  useEffect(() => {
    if (!isOpen) return;
    setColumnMappings(createDefaultSheetMappings(fields));
    setShowConfirmStep(false);
    setExportSuccess(null);
    setErrorMessage(null);
  }, [isOpen, fields]);

  const loadWorksheets = useCallback(async (token: string, spreadsheetId: string) => {
    if (!spreadsheetId) {
      setWorksheets([]);
      setSelectedWorksheet('');
      return;
    }
    setIsLoadingTabs(true);
    setErrorMessage(null);
    try {
      const meta = await getSpreadsheetWorksheets(token, spreadsheetId);
      setSelectedSpreadsheetTitle(meta.title);
      setSelectedSpreadsheetUrl(meta.spreadsheetUrl);
      setWorksheets(meta.sheets);
      setSelectedWorksheet(meta.sheets[0]?.title ?? '');
    } catch (err) {
      if (err instanceof GoogleSheetsApiError && err.needsReauth) {
        clearGoogleAccessToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load worksheets.');
      setWorksheets([]);
      setSelectedWorksheet('');
    } finally {
      setIsLoadingTabs(false);
    }
  }, []);

  const loadSpreadsheets = useCallback(
    async (token: string) => {
      setIsLoadingSheets(true);
      setErrorMessage(null);
      try {
        const list = await listUserSpreadsheets(token);
        setSpreadsheets(list);
        if (list.length > 0 && !selectedSpreadsheetId) {
          setSelectedSpreadsheetId(list[0].id);
          await loadWorksheets(token, list[0].id);
        }
      } catch (err) {
        if (err instanceof GoogleSheetsApiError && err.needsReauth) {
          clearGoogleAccessToken();
          setAccessToken(null);
          setNeedsAuth(true);
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load spreadsheets.');
      } finally {
        setIsLoadingSheets(false);
      }
    },
    [loadWorksheets, selectedSpreadsheetId]
  );

  useEffect(() => {
    if (isOpen && accessToken && !needsAuth) {
      void loadSpreadsheets(accessToken);
    }
  }, [isOpen, accessToken, needsAuth, loadSpreadsheets]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isExporting, onClose]);

  const includedMappings = useMemo(
    () => columnMappings.filter((m) => m.included),
    [columnMappings]
  );

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setErrorMessage(null);
    try {
      const res = await signInWithGoogle();
      setUser(res.user);
      setAccessToken(res.accessToken);
      setNeedsAuth(false);
      await loadSpreadsheets(res.accessToken);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGoogle();
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setSpreadsheets([]);
    setWorksheets([]);
    setSelectedSpreadsheetId('');
    setSelectedWorksheet('');
    setShowConfirmStep(false);
  };

  const handleSelectSpreadsheet = async (spreadsheetId: string) => {
    setSelectedSpreadsheetId(spreadsheetId);
    setShowConfirmStep(false);
    setExportSuccess(null);
    if (accessToken && spreadsheetId) {
      await loadWorksheets(accessToken, spreadsheetId);
    }
  };

  const handleLoadManualSpreadsheet = async () => {
    const id = extractSpreadsheetId(manualIdInput);
    if (!id || !accessToken) return;
    setSelectedSpreadsheetId(id);
    await loadWorksheets(accessToken, id);
  };

  const handleCreateSpreadsheet = async () => {
    if (!accessToken) return;
    setIsCreatingSheet(true);
    setErrorMessage(null);
    try {
      const created = await createNewSpreadsheet(accessToken, newSheetTitle, newTabTitle);
      setSpreadsheets((prev) => [
        {
          id: created.spreadsheetId,
          name: created.title,
          webViewLink: created.spreadsheetUrl,
        },
        ...prev,
      ]);
      setSelectedSpreadsheetId(created.spreadsheetId);
      setSelectedSpreadsheetTitle(created.title);
      setSelectedSpreadsheetUrl(created.spreadsheetUrl);
      setWorksheets(created.sheets);
      setSelectedWorksheet(created.sheets[0]?.title ?? newTabTitle);
      setShowCreateNew(false);
      onNotify('success', 'Created Google Sheet', `"${created.title}" is ready for export.`);
    } catch (err) {
      if (err instanceof GoogleSheetsApiError && err.needsReauth) {
        clearGoogleAccessToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create spreadsheet.');
    } finally {
      setIsCreatingSheet(false);
    }
  };

  const handleToggleColumn = (sourceKey: string) => {
    setColumnMappings((prev) =>
      prev.map((m) => (m.sourceKey === sourceKey ? { ...m, included: !m.included } : m))
    );
  };

  const handleRenameColumnHeader = (sourceKey: string, header: string) => {
    setColumnMappings((prev) =>
      prev.map((m) => (m.sourceKey === sourceKey ? { ...m, sheetHeader: header } : m))
    );
  };

  const handleConfirmExport = async () => {
    if (!accessToken || !selectedSpreadsheetId || !selectedWorksheet || includedMappings.length === 0) {
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);
    try {
      const res = await exportRowsToGoogleSheet(accessToken, {
        spreadsheetId: selectedSpreadsheetId,
        sheetTitle: selectedWorksheet,
        mode: writeMode,
        columnMappings,
        rows,
        includeHeaders,
      });

      const sheetUrl =
        selectedSpreadsheetUrl || `https://docs.google.com/spreadsheets/d/${selectedSpreadsheetId}`;

      setExportSuccess({
        updatedRows: res.updatedRows,
        updatedRange: res.updatedRange,
        sheetUrl,
      });
      setShowConfirmStep(false);

      onNotify(
        'success',
        'Exported to Google Sheets',
        `${writeMode === 'overwrite' ? 'Overwrote' : 'Appended'} ${rows.length} row(s) in "${selectedWorksheet}".`
      );
    } catch (err) {
      if (err instanceof GoogleSheetsApiError && err.needsReauth) {
        clearGoogleAccessToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setShowConfirmStep(false);
      setErrorMessage(err instanceof Error ? err.message : 'Export to Google Sheets failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const canInitiateExport =
    !needsAuth &&
    Boolean(accessToken) &&
    Boolean(selectedSpreadsheetId) &&
    Boolean(selectedWorksheet) &&
    includedMappings.length > 0 &&
    rows.length > 0 &&
    !isExporting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gsheets-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-white/[0.12] bg-[#131519] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h2 id="gsheets-modal-title" className="text-sm font-semibold text-[#F3F4F6]">
              Export to Google Sheets
            </h2>
            <span className="text-xs text-[#9CA3AF] tabular-nums">
              · {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close Google Sheets export modal"
            onClick={onClose}
            className="rounded p-1 text-[#9CA3AF] hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-rose-500/35 bg-rose-500/[0.08] p-3 text-xs text-rose-200 flex items-start gap-2"
            >
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Unauthenticated State: Official Google Sign-In Button */}
          {needsAuth || !accessToken ? (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="space-y-1.5 max-w-md">
                <h3 className="text-sm font-semibold text-[#F3F4F6]">
                  Connect your Google account
                </h3>
                <p className="text-xs leading-relaxed text-[#9CA3AF]">
                  Sign in with Google to browse your spreadsheets, pick a worksheet tab, map your
                  extracted JSON fields to columns, and append or overwrite rows. Your access token
                  is kept in memory only.
                </p>
              </div>

              <button
                type="button"
                disabled={isSigningIn}
                onClick={handleSignIn}
                className="inline-flex h-10 items-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 text-sm font-medium text-[#1f1f1f] shadow-xs hover:bg-[#f8f9fa] disabled:opacity-60 transition-colors"
              >
                {isSigningIn ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#4285F4]" aria-hidden="true" />
                ) : (
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    className="h-4 w-4 block"
                    aria-hidden="true"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                )}
                <span>{isSigningIn ? 'Signing in…' : 'Sign in with Google'}</span>
              </button>
            </div>
          ) : (
            <>
              {/* Connected User Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-[#0B0C0E] px-3.5 py-2.5 text-xs">
                <div className="min-w-0">
                  <span className="text-[#9CA3AF]">Connected as </span>
                  <span className="font-medium text-[#F3F4F6]">
                    {user?.email ?? user?.displayName ?? 'Google Account'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 text-[#9CA3AF] hover:text-rose-400 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>

              {/* Target Spreadsheet & Worksheet Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="gsheet-select" className="text-xs font-medium text-[#D1D5DB]">
                    Target Google Sheet
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateNew((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#60A5FA] hover:text-[#93C5FD]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{showCreateNew ? 'Select Existing' : 'New Spreadsheet'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isLoadingSheets}
                      onClick={() => accessToken && void loadSpreadsheets(accessToken)}
                      className="inline-flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-white disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isLoadingSheets ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {showCreateNew ? (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-3">
                    <input
                      type="text"
                      aria-label="New spreadsheet title"
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      placeholder="Spreadsheet title"
                      className="rounded-md border border-white/[0.1] bg-[#131519] px-2.5 py-1.5 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label="Initial worksheet tab name"
                      value={newTabTitle}
                      onChange={(e) => setNewTabTitle(e.target.value)}
                      placeholder="Worksheet name"
                      className="rounded-md border border-white/[0.1] bg-[#131519] px-2.5 py-1.5 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isCreatingSheet || !newSheetTitle.trim()}
                      onClick={handleCreateSpreadsheet}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#3B82F6] px-3 text-xs font-medium text-white hover:bg-[#2563EB] disabled:opacity-40 whitespace-nowrap"
                    >
                      {isCreatingSheet && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      <span>Create</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      id="gsheet-select"
                      value={selectedSpreadsheetId}
                      disabled={isLoadingSheets}
                      onChange={(e) => void handleSelectSpreadsheet(e.target.value)}
                      className="w-full rounded-md border border-white/[0.1] bg-[#0B0C0E] px-3 py-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                    >
                      {spreadsheets.length === 0 ? (
                        <option value="">
                          {isLoadingSheets
                            ? 'Loading spreadsheets…'
                            : 'No spreadsheets found — create a new one or paste a URL below'}
                        </option>
                      ) : (
                        spreadsheets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))
                      )}
                    </select>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        aria-label="Or paste Google Sheet URL or ID"
                        value={manualIdInput}
                        onChange={(e) => setManualIdInput(e.target.value)}
                        placeholder="Or paste a Google Sheet URL / Spreadsheet ID…"
                        className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-[#0B0C0E] px-2.5 py-1.5 font-mono text-[11px] text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={!manualIdInput.trim()}
                        onClick={handleLoadManualSpreadsheet}
                        className="rounded-md border border-white/[0.1] bg-[#1A1D23] px-3 py-1.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 whitespace-nowrap"
                      >
                        Load Sheet
                      </button>
                    </div>
                  </div>
                )}

                {/* Worksheet Tab Selector */}
                <div className="space-y-1.5">
                  <label htmlFor="worksheet-select" className="block text-xs font-medium text-[#D1D5DB]">
                    Target Worksheet Tab
                  </label>
                  <select
                    id="worksheet-select"
                    value={selectedWorksheet}
                    disabled={isLoadingTabs || worksheets.length === 0}
                    onChange={(e) => {
                      setSelectedWorksheet(e.target.value);
                      setShowConfirmStep(false);
                    }}
                    className="w-full rounded-md border border-white/[0.1] bg-[#0B0C0E] px-3 py-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none disabled:opacity-50"
                  >
                    {worksheets.length === 0 ? (
                      <option value="">
                        {isLoadingTabs ? 'Fetching worksheet tabs…' : 'Select a spreadsheet first'}
                      </option>
                    ) : (
                      worksheets.map((ws) => (
                        <option key={ws.sheetId} value={ws.title}>
                          {ws.title}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {/* Write Mode & Header Option */}
              <div className="space-y-2.5">
                <span className="block text-xs font-medium text-[#D1D5DB]">Write Behavior</span>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-1">
                  <button
                    type="button"
                    aria-pressed={writeMode === 'append'}
                    onClick={() => {
                      setWriteMode('append');
                      setShowConfirmStep(false);
                    }}
                    className={`rounded px-3 py-2 text-xs font-medium transition-colors ${
                      writeMode === 'append'
                        ? 'bg-[#1F242E] text-[#F3F4F6]'
                        : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
                    }`}
                  >
                    Append to existing data
                  </button>
                  <button
                    type="button"
                    aria-pressed={writeMode === 'overwrite'}
                    onClick={() => {
                      setWriteMode('overwrite');
                      setShowConfirmStep(false);
                    }}
                    className={`rounded px-3 py-2 text-xs font-medium transition-colors ${
                      writeMode === 'overwrite'
                        ? 'bg-[#1F242E] text-[#F3F4F6]'
                        : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
                    }`}
                  >
                    Overwrite worksheet
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-[#9CA3AF] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeHeaders}
                    onChange={(e) => setIncludeHeaders(e.target.checked)}
                    className="rounded accent-[#3B82F6]"
                  />
                  <span>
                    Include header row{' '}
                    {writeMode === 'append' ? '(automatically skipped if row 1 already has data)' : ''}
                  </span>
                </label>
              </div>

              {/* Field-to-Column Mapping */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-[#D1D5DB]">
                    Field-to-Column Mapping
                  </span>
                  <span className="text-xs text-[#9CA3AF] tabular-nums">
                    {includedMappings.length} column{includedMappings.length === 1 ? '' : 's'} mapped
                  </span>
                </div>

                <div className="max-h-52 overflow-y-auto rounded-md border border-white/[0.08] bg-[#0B0C0E] divide-y divide-white/[0.06]">
                  {(() => {
                    let activeColIndex = 0;
                    return columnMappings.map((mapping) => {
                      const colLetter = mapping.included
                        ? indexToColumnLetter(activeColIndex++)
                        : '—';
                      return (
                        <div
                          key={mapping.sourceKey}
                          className="grid grid-cols-[28px_36px_1fr_1fr] items-center gap-2 px-3 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            aria-label={`Include ${mapping.label} column`}
                            checked={mapping.included}
                            onChange={() => handleToggleColumn(mapping.sourceKey)}
                            className="rounded accent-[#3B82F6]"
                          />
                          <span className="font-mono text-[11px] text-[#60A5FA] text-center">
                            {colLetter}
                          </span>
                          <span className="font-mono text-[#9CA3AF] truncate">
                            {mapping.label}
                          </span>
                          <input
                            type="text"
                            aria-label={`Sheet header for ${mapping.label}`}
                            disabled={!mapping.included}
                            value={mapping.sheetHeader}
                            onChange={(e) =>
                              handleRenameColumnHeader(mapping.sourceKey, e.target.value)
                            }
                            className="rounded border border-white/[0.09] bg-[#131519] px-2 py-1 text-xs text-[#E6E8EC] disabled:opacity-40 focus:border-[#3B82F6] focus:outline-none"
                          />
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Export Success Banner */}
              {exportSuccess && (
                <div
                  role="status"
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] p-3.5 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      Wrote {exportSuccess.updatedRows} row(s) to{' '}
                      <code className="font-mono text-emerald-100">{exportSuccess.updatedRange}</code>.
                    </span>
                  </div>
                  <a
                    href={exportSuccess.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:underline whitespace-nowrap"
                  >
                    <span>Open Sheet</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              )}

              {/* Mandatory Confirmation Step before Mutating User Spreadsheet */}
              {showConfirmStep ? (
                <div
                  role="alertdialog"
                  aria-labelledby="gsheets-confirm-heading"
                  className={`rounded-md border p-4 space-y-3 ${
                    writeMode === 'overwrite'
                      ? 'border-rose-500/40 bg-rose-500/[0.08]'
                      : 'border-[#3B82F6]/40 bg-[#3B82F6]/[0.08]'
                  }`}
                >
                  <div className="space-y-1">
                    <h3
                      id="gsheets-confirm-heading"
                      className={`text-xs font-semibold ${
                        writeMode === 'overwrite' ? 'text-rose-300' : 'text-[#93C5FD]'
                      }`}
                    >
                      {writeMode === 'overwrite'
                        ? 'Confirm Overwrite of Worksheet'
                        : 'Confirm Append to Worksheet'}
                    </h3>
                    <p className="text-xs leading-relaxed text-[#E6E8EC]">
                      {writeMode === 'overwrite'
                        ? `This will permanently clear all existing values in worksheet "${selectedWorksheet}" of "${selectedSpreadsheetTitle || selectedSpreadsheetId}" and write ${rows.length} row(s) across ${includedMappings.length} mapped column(s).`
                        : `This will append ${rows.length} row(s) across ${includedMappings.length} mapped column(s) to worksheet "${selectedWorksheet}" in "${selectedSpreadsheetTitle || selectedSpreadsheetId}".`}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => setShowConfirmStep(false)}
                      className="h-8 rounded-md border border-white/[0.12] px-3 text-xs font-medium text-[#D1D5DB] hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={handleConfirmExport}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium text-white disabled:opacity-50 ${
                        writeMode === 'overwrite'
                          ? 'bg-rose-600 hover:bg-rose-500'
                          : 'bg-[#3B82F6] hover:bg-[#2563EB]'
                      }`}
                    >
                      {isExporting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      <span>
                        {isExporting
                          ? 'Exporting…'
                          : writeMode === 'overwrite'
                            ? 'Confirm Overwrite'
                            : 'Confirm Append'}
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 rounded-md border border-white/[0.1] px-3.5 text-xs font-medium text-[#9CA3AF] hover:text-white transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={!canInitiateExport}
                    onClick={() => setShowConfirmStep(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-[#3B82F6] px-4 text-xs font-medium text-white hover:bg-[#2563EB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {writeMode === 'overwrite'
                        ? 'Review & Overwrite Sheet'
                        : 'Review & Append to Sheet'}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
