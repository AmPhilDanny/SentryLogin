import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Upload as UploadIcon,
  FileText,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Eye,
  Play,
  Trash2,
  X,
  Search,
} from 'lucide-react';
import {
  api,
  DatasetItem,
  DatasetHead,
  UploadResponse,
  DetectionResult,
} from '../lib/api';
import { useAuth } from '../lib/auth';

const KIND_BADGE: Record<DetectionResult['kind'], string> = {
  login_standard: 'bg-risk-low/10 text-risk-low',
  ssh_syslog: 'bg-accent/10 text-accent',
  network_flow: 'bg-gray-600/20 text-gray-300',
  unknown: 'bg-risk-critical/10 text-risk-critical',
};

function StatusBadge({ item }: { item: DatasetItem }) {
  if (item.status === 'analyzing') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        <div className="w-32">
          <p className="text-xs font-medium text-accent">{item.stage ?? 'Analyzing…'}</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }
  if (item.status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-risk-low">
        <CheckCircle className="h-4 w-4" /> Complete
      </span>
    );
  }
  if (item.status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-risk-critical"
        title={item.error ?? ''}
      >
        <AlertTriangle className="h-4 w-4" /> Failed
      </span>
    );
  }
  return <span className="text-xs font-medium text-gray-400">Uploaded</span>;
}

function MappingChip({ label, mapping }: { label: string; mapping: { column: string | null; source: string | null } }) {
  if (!mapping.source) return null;
  const fromMessage = mapping.source === 'message';
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-gray-700/60 bg-gray-800/60 px-2 py-1 text-xs text-gray-300">
      <span className="text-gray-500">{label}</span>
      <span className="text-accent">←</span>
      <span className="font-medium text-white">
        {fromMessage ? `${mapping.column} (message)` : mapping.column}
      </span>
    </span>
  );
}

export default function Upload() {
  const { hasRole } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [headFor, setHeadFor] = useState<DatasetItem | null>(null);
  const [headData, setHeadData] = useState<DatasetHead | null>(null);
  const [loadingHead, setLoadingHead] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canManage = hasRole(['manager', 'super_admin']);
  const canDelete = hasRole(['super_admin']);
  if (!canManage) return <Navigate to="/" replace />;

  const refresh = useCallback(async () => {
    try {
      setDatasets(await api.getDatasets());
    } catch {
      // list refresh failure is non-fatal; the table shows stale data
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyAnalyzing = datasets.some((d) => d.status === 'analyzing');
  useEffect(() => {
    if (!anyAnalyzing) return;
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [anyAnalyzing, refresh]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith('.csv')) {
      setFile(f);
      setUploadError(null);
      setLastUpload(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setLastUpload(null);
    try {
      const res = await api.uploadCsv(file);
      setLastUpload(res);
      setFile(null);
      await refresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async (item: DatasetItem) => {
    setActionError(null);
    try {
      await api.analyzeDataset(item.id);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Analysis could not start');
    }
  };

  const handleHead = async (item: DatasetItem) => {
    setHeadFor(item);
    setHeadData(null);
    setLoadingHead(true);
    try {
      setHeadData(await api.getDatasetHead(item.id, 30));
    } catch {
      setHeadData(null);
    } finally {
      setLoadingHead(false);
    }
  };

  const handleDelete = async (item: DatasetItem) => {
    if (!window.confirm(`Delete dataset "${item.filename}"? This removes its analyzed logins, risk scores and alerts.`)) {
      return;
    }
    setDeletingId(item.id);
    setActionError(null);
    try {
      await api.deleteDataset(item.id);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const analyzeDisabled = (item: DatasetItem) =>
    item.status === 'analyzing' ||
    item.status === 'complete' ||
    (item.detection !== null && !item.detection.canAnalyze);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Upload & Analyze</h2>
        <p className="mt-1 text-sm text-gray-400">
          Stage 1 — upload stores your CSV and auto-detects its format. Stage 2 — run the analysis with live progress.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-gray-600 hover:border-gray-500'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <UploadIcon className="mb-4 h-12 w-12 text-gray-400" />
        <p className="text-base font-medium text-gray-300">
          {file ? file.name : 'Drop your CSV here or click to browse'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Any login log works — standard columns, SSH syslog, or headerless exports are detected automatically
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploadError(null);
            setLastUpload(null);
          }}
        />
      </div>

      {uploadError && (
        <div className="card flex items-center gap-3 border-risk-critical/40">
          <AlertCircle className="h-5 w-5 shrink-0 text-risk-critical" />
          <p className="text-sm text-risk-critical">{uploadError}</p>
        </div>
      )}

      {file && (
        <div className="card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-accent" />
            <div>
              <p className="text-sm font-medium text-white">{file.name}</p>
              <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <button onClick={handleUpload} disabled={uploading} className="btn-primary">
            {uploading ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Upload'
            )}
          </button>
        </div>
      )}

      {lastUpload && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <FileText className="h-5 w-5 text-accent" />
              {lastUpload.filename}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[lastUpload.detection.kind]}`}>
                {lastUpload.detection.kindLabel}
              </span>
            </h3>
            <span className="text-xs text-gray-400">
              {lastUpload.rowCount.toLocaleString()} rows · {lastUpload.detection.confidence}% confidence
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <MappingChip label="Username" mapping={lastUpload.detection.mapping.username} />
            <MappingChip label="Timestamp" mapping={lastUpload.detection.mapping.timestamp} />
            <MappingChip label="IP" mapping={lastUpload.detection.mapping.ip} />
            <MappingChip label="Country" mapping={lastUpload.detection.mapping.country} />
            <MappingChip label="City" mapping={lastUpload.detection.mapping.city} />
            <MappingChip label="Device" mapping={lastUpload.detection.mapping.device} />
            <MappingChip label="Browser" mapping={lastUpload.detection.mapping.browser} />
            <MappingChip label="Success" mapping={lastUpload.detection.mapping.success} />
          </div>

          <ul className="space-y-1">
            {lastUpload.detection.feedback.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {lastUpload.detection.canAnalyze ? (
            <p className="flex items-center gap-1 text-sm text-accent">
              <Play className="h-4 w-4" />
              Stored. Click <span className="font-semibold">Analyse</span> on the row below to run the risk pipeline.
            </p>
          ) : (
            <p className="flex items-center gap-1 text-sm text-risk-critical">
              <AlertTriangle className="h-4 w-4" />
              Not analyzable as a login log — you can still view or delete it.
            </p>
          )}
        </div>
      )}

      {actionError && (
        <div className="card flex items-center gap-3 border-risk-critical/40">
          <AlertCircle className="h-5 w-5 shrink-0 text-risk-critical" />
          <p className="text-sm text-risk-critical">{actionError}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h3 className="font-semibold text-white">Uploaded datasets</h3>
          <button onClick={() => void refresh()} className="btn-ghost" title="Refresh">
            <Search className="mr-1 h-4 w-4" /> Refresh
          </button>
        </div>

        {datasets.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            No datasets yet — upload a CSV above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-5 py-3 font-medium">Filename</th>
                  <th className="px-3 py-3 font-medium">Rows</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Imported</th>
                  <th className="px-3 py-3 font-medium">Flagged</th>
                  <th className="px-3 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((item) => (
                  <tr key={item.id} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/30">
                    <td className="max-w-[220px] truncate px-5 py-3 font-medium text-white" title={item.filename}>
                      {item.filename}
                    </td>
                    <td className="px-3 py-3 text-gray-300">{item.rowCount.toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <StatusBadge item={item} />
                    </td>
                    <td className="px-3 py-3 text-gray-300">
                      {item.status === 'complete' ? item.importedCount.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {item.status === 'complete' ? (
                        <span className={item.flaggedCount > 0 ? 'text-risk-high' : 'text-risk-low'}>
                          {item.flaggedCount.toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-500">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => void handleHead(item)}
                          className="btn-ghost"
                          title="View first rows of the raw file"
                        >
                          <Eye className="mr-1 h-4 w-4" /> Head
                        </button>
                        <button
                          onClick={() => void handleAnalyze(item)}
                          disabled={analyzeDisabled(item) || deletingId === item.id}
                          className="btn-ghost"
                          title={
                            item.status === 'analyzing'
                              ? 'Analysis already running'
                              : item.status === 'complete'
                                ? 'Already analyzed'
                                : !item.detection?.canAnalyze
                                  ? item.detection?.feedback.join(' ') ?? 'Not analyzable'
                                  : 'Run risk analysis'
                          }
                        >
                          {item.status === 'analyzing' ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-4 w-4" />
                          )}
                          Analyse
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => void handleDelete(item)}
                            disabled={item.status === 'analyzing' || deletingId === item.id}
                            className="btn-ghost text-risk-critical hover:border-risk-critical/50"
                            title={item.status === 'analyzing' ? 'Wait for analysis to finish' : 'Delete dataset and all its analysis'}
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1 h-4 w-4" />
                            )}
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {headFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setHeadFor(null)}
        >
          <div
            className="card max-h-[80vh] w-full max-w-4xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <h3 className="flex items-center gap-2 font-semibold text-white">
                <Eye className="h-5 w-5 text-accent" />
                {headFor.filename}
                {headData && (
                  <span className="text-xs font-normal text-gray-500">
                    first {headData.rows.length} of {headData.total.toLocaleString()} rows
                  </span>
                )}
              </h3>
              <button onClick={() => setHeadFor(null)} className="btn-ghost" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto">
              {loadingHead ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : headData ? (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="text-gray-400">
                      {headData.columns.map((c, i) => (
                        <th key={i} className="whitespace-nowrap border-b border-gray-800 px-3 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {headData.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-800/50">
                        {row.map((cell, ci) => (
                          <td key={ci} className="max-w-[260px] truncate px-3 py-1.5 text-gray-300" title={cell}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-10 text-center text-sm text-gray-500">Could not read file head</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
