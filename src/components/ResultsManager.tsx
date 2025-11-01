/**
 * Results Manager Component
 * 
 * Displays all Result_N folders stored on the server (AWS/Vercel Blob)
 * Allows downloading and viewing individual results
 */

'use client';

import { useState, useEffect } from 'react';
import { 
  IoCloudDownloadOutline, 
  IoFolderOpenOutline, 
  IoTimeOutline,
  IoFileTrayFullOutline,
  IoRefreshOutline,
  IoCloseOutline,
  IoCheckmarkCircleOutline,
  IoTrashOutline
} from 'react-icons/io5';

interface ResultFolder {
  name: string;
  fileCount: number;
  size: number;
  created: string;
  storage: 'aws_s3' | 'vercel';
  solutions?: number;
  solver_type?: string;
  execution_time?: number;
}

interface ResultsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ResultsManager({ isOpen, onClose }: ResultsManagerProps) {
  const [folders, setFolders] = useState<ResultFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load folders on mount
  useEffect(() => {
    if (isOpen) {
      loadFolders();
    }
  }, [isOpen]);

  const loadFolders = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get AWS Solver URL from environment
      const awsSolverUrl = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
      if (!awsSolverUrl) {
        throw new Error('AWS Solver URL not configured');
      }

      // Call Lambda API directly (no auth required)
      const response = await fetch(`${awsSolverUrl}/results/folders`);
      
      if (!response.ok) {
        throw new Error(`Failed to load results: ${response.status}`);
      }

      const data = await response.json();
      
      // For each folder, use the metadata we have from Lambda
      const lambdaFolders = (data.folders || []).map((folder: { name?: string; created?: string; solver_type?: string; solutions_count?: number; file_count?: number; total_size?: number; runtime_seconds?: number }) => {
        return {
          name: folder.name || '',
          fileCount: folder.file_count || 0,
          size: folder.total_size || 0,
          created: folder.created || new Date().toISOString(),
          storage: 'aws_s3' as const,
          solutions: folder.solutions_count || 0,
          solver_type: folder.solver_type || 'aws_lambda',
          execution_time: (folder.runtime_seconds || 0) * 1000, // Convert seconds to milliseconds
        };
      });
      
      setFolders(lambdaFolders);
    } catch (err) {
      console.error('Error loading results:', err);
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  };

  const downloadFolder = async (folderName: string) => {
    setDownloading(folderName);
    setError(null);

    try {
      const awsSolverUrl = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
      if (!awsSolverUrl) {
        throw new Error('AWS Solver URL not configured');
      }

      const response = await fetch(`${awsSolverUrl}/download/folder/${folderName}`);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      // Download as ZIP file
      const blob = await response.blob();
      
      // Check if blob is empty
      if (blob.size === 0) {
        throw new Error('Downloaded file is empty - results may not have been saved correctly');
      }
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Error downloading:', err);
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const deleteFolder = async (folderName: string) => {
    if (!confirm(`Are you sure you want to delete ${folderName}? This cannot be undone.`)) {
      return;
    }

    setDeleting(folderName);
    setError(null);

    try {
      const awsSolverUrl = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
      if (!awsSolverUrl) {
        throw new Error('AWS Solver URL not configured');
      }

      const response = await fetch(`${awsSolverUrl}/results/delete/${folderName}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || data.status !== 'deleted') {
        throw new Error('Delete response invalid');
      }

      // Remove from local state
      setFolders(folders.filter(f => f.name !== folderName));

    } catch (err) {
      console.error('Error deleting:', err);
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
              <IoFileTrayFullOutline className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Results Manager
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {folders.length} result{folders.length !== 1 ? 's' : ''} available
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={loadFolders}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Refresh"
            >
              <IoRefreshOutline className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <IoCloseOutline className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {loading && folders.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <IoRefreshOutline className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
                <p className="text-gray-600 dark:text-gray-400">Loading results...</p>
              </div>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <IoFolderOpenOutline className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600 dark:text-gray-400">No results found</p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  Run an optimization to generate results
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {folders.map((folder) => (
                <div
                  key={folder.name}
                  className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700 dark:to-blue-900/20 rounded-xl p-5 border border-gray-200 dark:border-gray-600 hover:shadow-lg transition-all duration-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-3">
                        <IoFolderOpenOutline className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                          {folder.name}
                        </h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          folder.storage === 'aws_s3' 
                            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        }`}>
                          {folder.storage === 'aws_s3' ? 'AWS S3' : 'Vercel Blob'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500 dark:text-gray-400 mb-1">Files</p>
                          <p className="font-semibold text-gray-900 dark:text-white">
                            {folder.fileCount}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400 mb-1">Size</p>
                          <p className="font-semibold text-gray-900 dark:text-white">
                            {formatFileSize(folder.size)}
                          </p>
                        </div>
                        {folder.solutions !== undefined && (
                          <div>
                            <p className="text-gray-500 dark:text-gray-400 mb-1">Solutions</p>
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {folder.solutions}
                            </p>
                          </div>
                        )}
                        {folder.execution_time !== undefined && (
                          <div>
                            <p className="text-gray-500 dark:text-gray-400 mb-1">Runtime</p>
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {(folder.execution_time / 1000).toFixed(2)}s
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
                        <IoTimeOutline className="w-4 h-4" />
                        <span>{formatDate(folder.created)}</span>
                        {folder.solver_type && (
                          <>
                            <span>•</span>
                            <span className="capitalize">{folder.solver_type.replace('_', ' ')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col space-y-2 ml-4">
                      <button
                        onClick={() => downloadFolder(folder.name)}
                        disabled={downloading === folder.name || deleting === folder.name}
                        className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-md hover:shadow-lg"
                      >
                        {downloading === folder.name ? (
                          <>
                            <IoRefreshOutline className="w-4 h-4 animate-spin" />
                            <span className="text-sm font-semibold">Downloading...</span>
                          </>
                        ) : (
                          <>
                            <IoCloudDownloadOutline className="w-4 h-4" />
                            <span className="text-sm font-semibold">Download ZIP</span>
                          </>
                        )}
                      </button>
                      
                      <button
                        onClick={() => deleteFolder(folder.name)}
                        disabled={downloading === folder.name || deleting === folder.name}
                        className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-lg hover:from-red-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-md hover:shadow-lg"
                      >
                        {deleting === folder.name ? (
                          <>
                            <IoRefreshOutline className="w-4 h-4 animate-spin" />
                            <span className="text-sm font-semibold">Deleting...</span>
                          </>
                        ) : (
                          <>
                            <IoTrashOutline className="w-4 h-4" />
                            <span className="text-sm font-semibold">Delete</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
            <IoCheckmarkCircleOutline className="w-5 h-5 text-green-500" />
            <span>Results are stored securely in the cloud</span>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
