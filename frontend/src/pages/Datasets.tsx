import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  FileDown,
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { api, DatasetItem, DatasetPreview } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Datasets() {
  const { user, hasRole } = useAuth();
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const canDelete = hasRole(['super_admin']);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDatasets()
      .then((data) => {
        if (!cancelled) setDatasets(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load datasets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const togglePreview = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setPreview(null);
        return;
      }
      setExpandedId(id);
      setPreviewLoading(true);
      setPreview(null);
      try {
        setPreview(await api.getDatasetPreview(id));
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [expandedId],
  );

  const handleDelete = useCallback(
    async (item: DatasetItem) => {
      if (!window.confirm(`Delete dataset "${item.filename}"? This removes all ${item.importedCount} imported logins, alerts and explanations for this dataset.`)) {
        return;
      }
      setDeletingId(item.id);
      try {
        await api.deleteDataset(item.id);
        if (expandedId === item.id) {
          setExpandedId(null);
          setPreview(null);
        }
        setReload((r) => r + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete dataset');
      } finally {
        setDeletingId(null);
      }
    },
    [expandedId],
  );

  const handleDownload = useCallback(
    async (item: DatasetItem) => {
      try {
        await api.downloadDataset(item);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to download dataset');
      }
    },
    [],
  );

  const totalImported = datasets.reduce((sum, d) => sum + d.importedCount, 0);
  const totalFlagged = datasets.reduce((sum, d) => sum + d.flaggedCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Database className="h-6 w-6 text-accent" />
          Datasets
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Uploaded CSV files stored in the database — preview, download or delete
        </p>
      </div>

      {datasets.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-400">
            {datasets.length} dataset{datasets.length !== 1 ? 's' : ''}
          </span>
          <span className="text-gray-400">
            {totalImported.toLocaleString()} logins imported
          </span>
          <span className="text-gray-400">
            {totalFlagged.toLocaleString()} flagged
          </span>
        </div>
      )}

      <div className="card">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-risk-high">{error}</p>
            <button onClick={() => setReload((r) => r + 1)} className="btn-ghost">
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading datasets...
          </div>
        ) : datasets.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500">No datasets uploaded yet.</p>
            <p className="mt-1 text-sm text-gray-600">
              Go to the Upload page to import a CSV.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3 font-medium">Filename</th>
                  <th className="py-2 pr-3 font-medium">Imported</th>
                  <th className="py-2 pr-3 font-medium">Flagged</th>
                  <th className="py-2 pr-3 font-medium">Uploaded</th>
                  <th className="py-2 pr-3 font-medium">By</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((item) => (
                  <DatasetRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    preview={preview}
                    previewLoading={previewLoading}
                    canDelete={canDelete}
                    deleting={deletingId === item.id}
                    isCurrentUser={user?.email === item.createdBy}
                    onTogglePreview={() => togglePreview(item.id)}
                    onDownload={() => handleDownload(item)}
                    onDelete={() => handleDelete(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetRow({
  item,
  expanded,
  preview,
  previewLoading,
  canDelete,
  deleting,
  isCurrentUser,
  onTogglePreview,
  onDownload,
  onDelete,
}: {
  item: DatasetItem;
  expanded: boolean;
  preview: DatasetPreview | null;
  previewLoading: boolean;
  canDelete: boolean;
  deleting: boolean;
  isCurrentUser: boolean;
  onTogglePreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-800/50 transition-colors hover:bg-surface-lighter/40">
        <td className="py-2.5 pr-3 font-medium text-white">{item.filename}</td>
        <td className="py-2.5 pr-3 text-gray-300">{item.importedCount.toLocaleString()}</td>
        <td className="py-2.5 pr-3">
          <span className={`badge ${item.flaggedCount > 0 ? 'badge-medium' : 'badge-low'}`}>
            {item.flaggedCount.toLocaleString()}
          </span>
        </td>
        <td className="py-2.5 pr-3 text-gray-300">
          {new Date(item.createdAt).toLocaleString()}
        </td>
        <td className="py-2.5 pr-3 text-gray-400">
          {item.createdBy}
          {isCurrentUser && <span className="ml-1 text-gray-600">(you)</span>}
        </td>
        <td className="py-2.5">
          <div className="flex gap-1">
            <button
              onClick={onTogglePreview}
              className="btn-ghost px-2 py-1 text-xs"
              title={expanded ? 'Hide preview' : 'Preview rows'}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <Eye className="ml-1 h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={onDownload}
              className="btn-ghost px-2 py-1 text-xs"
              title="Download CSV"
            >
              <FileDown className="h-3.5 w-3.5" />
            </button>
            {canDelete && (
              <button
                onClick={onDelete}
                disabled={deleting}
                className="btn-ghost px-2 py-1 text-xs text-risk-high hover:bg-risk-critical/10 disabled:opacity-40"
                title="Delete dataset"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-surface-lighter/30 py-3 pl-4 pr-4">
            {previewLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading preview...
              </div>
            ) : preview ? (
              <div>
                <p className="mb-2 text-xs text-gray-500">
                  {preview.total.toLocaleString()} rows total — showing first{' '}
                  {preview.rows.length}
                </p>
                <div className="max-h-80 overflow-auto rounded-md border border-gray-700/50">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface-light">
                      <tr className="border-b border-gray-700/50 text-gray-400">
                        {preview.columns.map((col) => (
                          <th key={col} className="px-2 py-1.5 font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/50">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1.5 text-gray-300">
                              {String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-gray-500">
                Failed to load preview.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
