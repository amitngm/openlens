'use client';

import { useState, useEffect } from 'react';
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Loader2,
  ExternalLink,
  RefreshCw,
  Download,
  Eye,
  AlertTriangle
} from 'lucide-react';

interface Run {
  run_id: string;
  discovery_id?: string;
  status: string;
  started_at: string;
  completed_at?: string;
  passed?: number;
  failed?: number;
  total?: number;
}

export default function ReportsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      setLoading(true);
      // Try test_runner endpoint first
      let response = await fetch('/api/run/runs');
      if (!response.ok) {
        // Try alternative endpoint
        response = await fetch('/api/runs');
      }
      if (!response.ok) throw new Error('Failed to fetch runs');
      const data = await response.json();
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const viewReport = async (runId: string) => {
    try {
      setLoadingReport(true);
      setError(null);
      setSelectedRun(runId);
      
      // Try test_runner endpoint first
      let response = await fetch(`/api/run/run/${runId}/report.html`);
      if (!response.ok) {
        // Try runs endpoint
        response = await fetch(`/api/runs/${runId}/report.html`);
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Report not found' }));
        throw new Error(errorData.error || 'Report not found');
      }
      
      const html = await response.text();
      setReportHtml(html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setReportHtml(null);
    } finally {
      setLoadingReport(false);
    }
  };

  const downloadReport = async (runId: string) => {
    try {
      let response = await fetch(`/api/run/run/${runId}/report.html`);
      if (!response.ok) {
        response = await fetch(`/api/runs/${runId}/report.html`);
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Report not found' }));
        throw new Error(errorData.error || 'Report not found');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${runId}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download report');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-8 h-8" />
                Test Reports
              </h1>
              <p className="mt-2 text-gray-600">
                View and download HTML test execution reports
              </p>
            </div>
            <button
              onClick={fetchRuns}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-red-800">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Runs List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Test Runs ({runs.length})
                </h2>
              </div>
              
              {loading ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                  <p className="mt-2 text-gray-500">Loading runs...</p>
                </div>
              ) : runs.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No test runs found</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {runs.map((run) => (
                    <div
                      key={run.run_id}
                      className={`p-4 hover:bg-gray-50 cursor-pointer transition ${
                        selectedRun === run.run_id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                      }`}
                      onClick={() => viewReport(run.run_id)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          <span className="font-mono text-sm text-gray-600">
                            {run.run_id.substring(0, 8)}...
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(run.status)}`}>
                          {run.status}
                        </span>
                      </div>
                      
                      <div className="text-xs text-gray-500 mb-2">
                        {formatDate(run.started_at)}
                      </div>
                      
                      {(run.passed !== undefined || run.failed !== undefined) && (
                        <div className="flex items-center gap-4 text-xs">
                          {run.passed !== undefined && (
                            <span className="text-green-600">
                              ✓ {run.passed} passed
                            </span>
                          )}
                          {run.failed !== undefined && run.failed > 0 && (
                            <span className="text-red-600">
                              ✗ {run.failed} failed
                            </span>
                          )}
                        </div>
                      )}
                      
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            viewReport(run.run_id);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                        >
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadReport(run.run_id);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Report Viewer */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedRun ? `Report: ${selectedRun.substring(0, 12)}...` : 'Select a run to view report'}
                </h2>
                {selectedRun && (
                  <button
                    onClick={() => downloadReport(selectedRun)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                )}
              </div>
              
              <div className="p-4">
                {!selectedRun ? (
                  <div className="text-center py-12 text-gray-500">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p>Select a test run from the list to view its HTML report</p>
                  </div>
                ) : loadingReport ? (
                  <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                    <p className="mt-2 text-gray-500">Loading report...</p>
                  </div>
                ) : reportHtml ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <iframe
                      srcDoc={reportHtml}
                      className="w-full h-[calc(100vh-250px)] border-0"
                      title="Test Report"
                      sandbox="allow-same-origin allow-scripts"
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <AlertTriangle className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p>Report not available for this run</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
