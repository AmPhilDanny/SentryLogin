import { useState, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Upload as UploadIcon, FileText, AlertCircle, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { api, IngestResult } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Upload() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!hasRole(['manager', 'super_admin'])) {
    return <Navigate to="/" replace />;
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith('.csv')) {
      setFile(f);
      setResult(null);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.uploadCsv(file);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Upload Login Data</h2>
        <p className="mt-1 text-sm text-gray-400">
          Upload a CSV file with login logs for analysis
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-gray-600 hover:border-gray-500'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <UploadIcon className="mb-4 h-12 w-12 text-gray-400" />
        <p className="text-base font-medium text-gray-300">
          {file ? file.name : 'Drop your CSV here or click to browse'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Expected columns: username, timestamp, ip, country, city, device, browser, success
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
      </div>

      {error && (
        <div className="card flex items-center gap-3 border-risk-critical/40">
          <AlertCircle className="h-5 w-5 shrink-0 text-risk-critical" />
          <p className="text-sm text-risk-critical">{error}</p>
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
                Processing...
              </>
            ) : (
              'Upload & Analyze'
            )}
          </button>
        </div>
      )}

      {result && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-white">Upload Results</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-gray-700/50 p-3">
              <p className="text-xs text-gray-400">Total Rows</p>
              <p className="mt-1 text-2xl font-bold text-white">{result.total}</p>
            </div>
            <div className="rounded-md border border-gray-700/50 p-3">
              <p className="text-xs text-gray-400">Imported</p>
              <p className="mt-1 text-2xl font-bold text-risk-low">{result.imported}</p>
            </div>
            <div className="rounded-md border border-gray-700/50 p-3">
              <p className="text-xs text-gray-400">Flagged Suspicious</p>
              <p className="mt-1 text-2xl font-bold text-risk-high">{result.flagged}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-risk-low" />
            <span>{result.valid} logins processed successfully</span>
          </div>
          {result.errors.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-risk-high">
                <AlertTriangle className="h-4 w-4" />
                {result.errors.length} rows skipped
              </p>
              {result.errors.slice(0, 20).map((e) => (
                <div key={e.row} className="flex items-start gap-2 text-sm text-risk-high">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Row {e.row}: {e.message}</span>
                </div>
              ))}
              {result.errors.length > 20 && (
                <p className="text-xs text-gray-500">
                  ...and {result.errors.length - 20} more
                </p>
              )}
            </div>
          )}
          <div className="pt-1">
            <button onClick={() => navigate('/')} className="btn-primary">
              View Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
