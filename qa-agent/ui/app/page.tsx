'use client';

import { useState, useCallback } from 'react';
import { 
  Play, 
  Search, 
  FileText, 
  Copy, 
  Check, 
  X, 
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Zap,
  AlertTriangle,
  Image as ImageIcon
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

interface ApiError {
  error: string;
  detail?: string;
  status: number;
}

interface Run {
  run_id: string;
  discovery_id: string;
  status: string;
  started_at: string;
  passed: number;
  failed: number;
}

interface TestStep {
  action: string;
  status: string;
  duration_ms?: number;
  error?: string;
}

interface TestResult {
  test_id: string;
  name: string;
  status: string;
  duration_ms: number;
  error?: string;
  evidence: string[];
  steps: TestStep[];
}

interface Report {
  run_id: string;
  status: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: string;
  };
  test_results: TestResult[];
}

interface Artifact {
  name: string;
  size: number;
  type: string;
  download_url: string;
  proxy_url: string;
}

// =============================================================================
// API Functions (using Next.js API routes)
// =============================================================================

async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw { 
      error: data.error || 'Request failed', 
      detail: data.detail,
      status: response.status 
    } as ApiError;
  }
  
  return data;
}

// =============================================================================
// Main Component
// =============================================================================

export default function Dashboard() {
  // Connection state - NEVER persisted to localStorage
  const [connection, setConnection] = useState({
    ui_url: '',
    username: '',
    password: '', // In-memory only
    env: 'staging'
  });
  
  // Prompt state
  const [prompt, setPrompt] = useState('');
  
  // Operation state
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  
  // Runs state
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  
  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Curl helper
  const [showCurl, setShowCurl] = useState(false);

  // ==========================================================================
  // Toast Helpers
  // ==========================================================================

  const addToast = useCallback((type: Toast['type'], title: string, message?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const showError = useCallback((error: ApiError | Error | unknown) => {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const apiError = error as ApiError;
      addToast('error', apiError.error, apiError.detail);
    } else if (error instanceof Error) {
      addToast('error', 'Error', error.message);
    } else {
      addToast('error', 'Unknown Error', String(error));
    }
  }, [addToast]);

  // ==========================================================================
  // Curl Command Generator
  // ==========================================================================

  const getCurl = (endpoint: string, body: object): string => {
    const redactedBody = JSON.parse(JSON.stringify(body));
    if (redactedBody.password) redactedBody.password = '***REDACTED***';
    
    return `curl -X POST 'http://localhost:8080${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(redactedBody, null, 2)}'`;
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    addToast('info', 'Copied to clipboard');
  };

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  const handleDiscover = async () => {
    if (!connection.ui_url) {
      addToast('warning', 'URL Required', 'Please enter a target URL');
      return;
    }
    
    setLoading('discover');
    setOutput('Starting discovery...\n');
    
    try {
      const data = await apiCall<{ discovery_id: string; status: string }>('/discover', {
        method: 'POST',
        body: JSON.stringify({
          ui_url: connection.ui_url,
          username: connection.username,
          password: connection.password,
          env: connection.env
        })
      });
      
      setDiscoveryId(data.discovery_id);
      setOutput(prev => prev + `Discovery started: ${data.discovery_id}\nPolling for results...`);
      addToast('success', 'Discovery Started', `ID: ${data.discovery_id}`);
      
      pollDiscovery(data.discovery_id);
      
    } catch (error) {
      showError(error);
      setOutput(prev => prev + `\nError: ${(error as ApiError).error || error}`);
    } finally {
      setLoading(null);
    }
  };

  const pollDiscovery = async (id: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    
    const poll = async () => {
      try {
        const data = await apiCall<any>(`/discover/${id}`);
        
        if (data.status === 'completed') {
          setOutput(JSON.stringify(data, null, 2));
          addToast('success', 'Discovery Completed', 
            `Found ${data.pages?.length || 0} pages, ${data.api_endpoints?.length || 0} APIs`);
        } else if (data.status === 'failed') {
          setOutput(JSON.stringify(data, null, 2));
          addToast('error', 'Discovery Failed', data.error);
        } else if (attempts < maxAttempts) {
          attempts++;
          setOutput(prev => {
            const lines = prev.split('\n').slice(0, 3);
            return lines.join('\n') + `\n\nStatus: ${data.status}... (${attempts}s)`;
          });
          setTimeout(poll, 2000);
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    };
    
    poll();
  };

  const handleGenerateTests = async () => {
    if (!discoveryId) {
      addToast('warning', 'No Discovery', 'Run discovery first');
      return;
    }
    
    setLoading('generate');
    setOutput('Generating tests...\n');
    
    try {
      const data = await apiCall<any>('/generate-tests', {
        method: 'POST',
        body: JSON.stringify({ discovery_id: discoveryId })
      });
      
      setOutput(JSON.stringify(data, null, 2));
      addToast('success', 'Tests Generated', `${data.total_tests} tests created`);
      
    } catch (error) {
      showError(error);
      setOutput(prev => prev + `\nError: ${(error as ApiError).error || error}`);
    } finally {
      setLoading(null);
    }
  };

  const handleRun = async () => {
    if (!discoveryId) {
      addToast('warning', 'No Discovery', 'Run discovery and generate tests first');
      return;
    }
    
    setLoading('run');
    setOutput('Starting test run...\n');
    
    try {
      const data = await apiCall<{ run_id: string; status: string }>('/run', {
        method: 'POST',
        body: JSON.stringify({
          discovery_id: discoveryId,
          suite: 'smoke',
          prompt: prompt || undefined
        })
      });
      
      setOutput(prev => prev + `Run started: ${data.run_id}\n`);
      addToast('success', 'Run Started', `ID: ${data.run_id}`);
      
      pollRun(data.run_id);
      
    } catch (error) {
      showError(error);
      setOutput(prev => prev + `\nError: ${(error as ApiError).error || error}`);
    } finally {
      setLoading(null);
    }
  };

  const pollRun = async (runId: string) => {
    let attempts = 0;
    const maxAttempts = 120;
    
    const poll = async () => {
      try {
        const data = await apiCall<any>(`/run/${runId}`);
        
        setOutput(prev => {
          const lines = prev.split('\n').slice(0, 2);
          return lines.join('\n') + `\n\nStatus: ${data.status}\nPassed: ${data.passed || 0} | Failed: ${data.failed || 0}\nCurrent: ${data.current_test || '-'}`;
        });
        
        if (data.status === 'completed' || data.status === 'failed') {
          addToast(
            data.status === 'completed' ? 'success' : 'error',
            `Run ${data.status}`,
            `${data.summary?.passed || data.passed || 0} passed, ${data.summary?.failed || data.failed || 0} failed`
          );
          loadRuns();
          loadReport(runId);
          loadArtifacts(runId);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    };
    
    poll();
  };

  const loadRuns = async () => {
    try {
      const data = await apiCall<{ runs: Run[] }>('/run');
      setRuns(data.runs || []);
    } catch (error) {
      console.error('Failed to load runs:', error);
    }
  };

  const loadReport = async (runId: string) => {
    try {
      const data = await apiCall<Report>(`/run/${runId}`);
      setSelectedReport(data);
    } catch (error) {
      console.error('Failed to load report:', error);
    }
  };

  const loadArtifacts = async (runId: string) => {
    try {
      const data = await apiCall<{ artifacts: Artifact[] }>(`/run/${runId}/artifacts`);
      setArtifacts(data.artifacts || []);
    } catch (error) {
      console.error('Failed to load artifacts:', error);
    }
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">QA Agent</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">
              Backend: <code className="bg-gray-100 px-1.5 py-0.5 rounded">localhost:8080</code>
            </span>
            <a 
              href="http://localhost:8080/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              API Docs <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Column */}
          <div className="col-span-4 space-y-6">
            
            {/* Connection Panel */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Search className="w-4 h-4" />
                Connection
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target URL</label>
                  <input
                    type="url"
                    value={connection.ui_url}
                    onChange={e => setConnection(c => ({ ...c, ui_url: e.target.value }))}
                    placeholder="https://your-app.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <input
                      type="text"
                      value={connection.username}
                      onChange={e => setConnection(c => ({ ...c, username: e.target.value }))}
                      placeholder="admin"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={connection.password}
                      onChange={e => setConnection(c => ({ ...c, password: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoComplete="off"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                  <select
                    value={connection.env}
                    onChange={e => setConnection(c => ({ ...c, env: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                
                {connection.env === 'production' && (
                  <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Production testing requires ALLOW_PROD=true on the server</span>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Panel */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                What do you want to test?
              </h2>
              
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe what you want to test...&#10;&#10;Examples:&#10;- Test the login flow&#10;- Check all API endpoints&#10;- Verify form validation"
                className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Right Column */}
          <div className="col-span-8 space-y-6">
            
            {/* Actions */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Actions</h2>
              
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDiscover}
                  disabled={loading !== null}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading === 'discover' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Discover
                </button>
                
                <button
                  onClick={handleGenerateTests}
                  disabled={loading !== null || !discoveryId}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50 border border-gray-300 flex items-center gap-2"
                >
                  {loading === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Generate Tests
                </button>
                
                <button
                  onClick={handleRun}
                  disabled={loading !== null || !discoveryId}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run Tests
                </button>
                
                <button
                  onClick={loadRuns}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 border border-gray-300 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>

                {/* Copy cURL Dropdown */}
                <div className="relative ml-auto">
                  <button
                    onClick={() => setShowCurl(!showCurl)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 border border-gray-300 flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    cURL
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  
                  {showCurl && (
                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                      {[
                        { name: 'Discover', endpoint: '/discover', body: { ui_url: connection.ui_url, username: connection.username, password: connection.password, env: connection.env } },
                        { name: 'Generate Tests', endpoint: '/generate-tests', body: { discovery_id: discoveryId || 'DISCOVERY_ID' } },
                        { name: 'Run', endpoint: '/run', body: { discovery_id: discoveryId || 'DISCOVERY_ID', suite: 'smoke' } },
                      ].map(({ name, endpoint, body }) => (
                        <button
                          key={name}
                          onClick={() => { copyToClipboard(getCurl(endpoint, body)); setShowCurl(false); }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {discoveryId && (
                <p className="text-xs text-gray-500 mt-3">
                  Discovery ID: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{discoveryId}</code>
                </p>
              )}
            </div>

            {/* Output */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Output</h2>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-auto max-h-48">
                {output || 'No output yet. Click "Discover" to start.'}
              </pre>
            </div>

            {/* Runs Table */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Test Runs</h2>
              
              {runs.length === 0 ? (
                <p className="text-sm text-gray-500">No runs yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left">
                        <th className="py-2 px-3 font-medium text-gray-600">Run ID</th>
                        <th className="py-2 px-3 font-medium text-gray-600">Status</th>
                        <th className="py-2 px-3 font-medium text-gray-600">Results</th>
                        <th className="py-2 px-3 font-medium text-gray-600">Started</th>
                        <th className="py-2 px-3 font-medium text-gray-600"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <tr key={run.run_id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-xs">{run.run_id}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              run.status === 'completed' ? 'bg-green-100 text-green-800' :
                              run.status === 'failed' ? 'bg-red-100 text-red-800' :
                              run.status === 'running' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-green-600">{run.passed}✓</span>
                            {' / '}
                            <span className="text-red-600">{run.failed}✗</span>
                          </td>
                          <td className="py-2 px-3 text-gray-500 text-xs">
                            {new Date(run.started_at).toLocaleString()}
                          </td>
                          <td className="py-2 px-3">
                            <button
                              onClick={() => { loadReport(run.run_id); loadArtifacts(run.run_id); }}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Report Viewer */}
            {selectedReport && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900">
                    Report: {selectedReport.run_id}
                  </h2>
                  <button onClick={() => setSelectedReport(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Summary */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Total', value: selectedReport.summary.total, bg: 'bg-gray-50' },
                    { label: 'Passed', value: selectedReport.summary.passed, bg: 'bg-green-50', color: 'text-green-600' },
                    { label: 'Failed', value: selectedReport.summary.failed, bg: 'bg-red-50', color: 'text-red-600' },
                    { label: 'Pass Rate', value: selectedReport.summary.pass_rate, bg: 'bg-blue-50', color: 'text-blue-600' },
                  ].map(({ label, value, bg, color }) => (
                    <div key={label} className={`text-center p-3 rounded-lg ${bg}`}>
                      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>
                
                {/* Test Results */}
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {selectedReport.test_results?.map(test => (
                    <TestResultCard key={test.test_id} test={test} />
                  ))}
                </div>

                {/* Artifacts */}
                {artifacts.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      Screenshots ({artifacts.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {artifacts.filter(a => a.type === 'image').map(artifact => (
                        <a
                          key={artifact.name}
                          href={artifact.proxy_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200"
                        >
                          {artifact.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg max-w-sm ${
              toast.type === 'success' ? 'bg-green-600 text-white' :
              toast.type === 'error' ? 'bg-red-600 text-white' :
              toast.type === 'warning' ? 'bg-amber-500 text-white' :
              'bg-gray-800 text-white'
            }`}
            style={{ animation: 'slideIn 0.3s ease-out' }}
          >
            <div className="flex-1">
              <p className="font-medium text-sm">{toast.title}</p>
              {toast.message && <p className="text-xs opacity-90 mt-0.5">{toast.message}</p>}
            </div>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// Test Result Card Component
// =============================================================================

function TestResultCard({ test }: { test: TestResult }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className={`border rounded-lg ${
      test.status === 'passed' ? 'border-green-200 bg-green-50' :
      test.status === 'failed' ? 'border-red-200 bg-red-50' :
      'border-gray-200 bg-gray-50'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <span className={`w-2 h-2 rounded-full ${
            test.status === 'passed' ? 'bg-green-500' :
            test.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
          }`} />
          <span className="text-sm font-medium text-gray-900">{test.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{test.duration_ms}ms</span>
          <span className={`text-xs font-medium uppercase ${
            test.status === 'passed' ? 'text-green-600' :
            test.status === 'failed' ? 'text-red-600' : 'text-gray-500'
          }`}>
            {test.status}
          </span>
        </div>
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200 mt-1 pt-3">
          {test.error && (
            <p className="text-xs text-red-600 mb-2 font-mono bg-red-100 p-2 rounded">
              {test.error}
            </p>
          )}
          
          <p className="text-xs font-medium text-gray-700 mb-2">Steps:</p>
          <div className="space-y-1">
            {test.steps?.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  step.status === 'passed' ? 'bg-green-500' :
                  step.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                }`} />
                <span className="text-gray-700">{step.action}</span>
                {step.duration_ms && <span className="text-gray-400">{step.duration_ms}ms</span>}
                {step.error && <span className="text-red-500 truncate max-w-xs">{step.error}</span>}
              </div>
            ))}
          </div>
          
          {test.evidence?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-700 mb-1">Evidence:</p>
              <div className="flex flex-wrap gap-1">
                {test.evidence.map((ev, idx) => (
                  <span key={idx} className="text-xs bg-gray-200 px-2 py-0.5 rounded">{ev}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
