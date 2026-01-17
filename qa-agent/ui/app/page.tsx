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
  Zap
} from 'lucide-react';

// Types
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface Run {
  run_id: string;
  discovery_id: string;
  status: string;
  started_at: string;
  passed: number;
  failed: number;
}

interface TestResult {
  test_id: string;
  name: string;
  status: string;
  duration_ms: number;
  error?: string;
  evidence: string[];
  steps: Array<{
    action: string;
    status: string;
    duration_ms: number;
    error?: string;
  }>;
}

interface Report {
  run_id: string;
  status: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    pass_rate: string;
  };
  test_results: TestResult[];
}

// API Base
const API_BASE = typeof window !== 'undefined' && window.location.port === '3000' 
  ? 'http://localhost:8080' 
  : '';

export default function Dashboard() {
  // Connection state (password in memory only)
  const [connection, setConnection] = useState({
    ui_url: '',
    username: '',
    password: '', // Never stored in localStorage
    env: 'staging'
  });
  
  // Prompt state
  const [prompt, setPrompt] = useState('');
  
  // Operation state
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null); // 'discover' | 'generate' | 'run'
  const [output, setOutput] = useState<string>('');
  
  // Runs state
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  
  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Curl helper
  const [showCurl, setShowCurl] = useState<string | null>(null);

  // Toast helpers
  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Generate curl command
  const getCurl = (endpoint: string, body: object): string => {
    const redactedBody = JSON.parse(JSON.stringify(body));
    if (redactedBody.password) redactedBody.password = '***REDACTED***';
    
    return `curl -X POST '${API_BASE}${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(redactedBody, null, 2)}'`;
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    addToast('info', 'Copied to clipboard');
  };

  // API calls
  const handleDiscover = async () => {
    if (!connection.ui_url) {
      addToast('error', 'Please enter a URL');
      return;
    }
    
    setLoading('discover');
    setOutput('Starting discovery...\n');
    
    try {
      const res = await fetch(`${API_BASE}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ui_url: connection.ui_url,
          username: connection.username,
          password: connection.password,
          config_name: 'default'
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setDiscoveryId(data.discovery_id);
        setOutput(prev => prev + `Discovery started: ${data.discovery_id}\nStatus: ${data.status}\n\nPolling for results...`);
        addToast('success', `Discovery started: ${data.discovery_id}`);
        
        // Poll for completion
        pollDiscovery(data.discovery_id);
      } else {
        throw new Error(data.detail || 'Discovery failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setOutput(prev => prev + `\nError: ${msg}`);
      addToast('error', msg);
    } finally {
      setLoading(null);
    }
  };

  const pollDiscovery = async (id: string) => {
    const maxAttempts = 60;
    let attempts = 0;
    
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/discover/${id}`);
        const data = await res.json();
        
        if (data.status === 'completed') {
          setOutput(JSON.stringify(data, null, 2));
          addToast('success', `Discovery completed! Found ${data.pages?.length || 0} pages, ${data.api_endpoints?.length || 0} APIs`);
        } else if (data.status === 'failed') {
          setOutput(JSON.stringify(data, null, 2));
          addToast('error', `Discovery failed: ${data.error}`);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    };
    
    poll();
  };

  const handleGenerateTests = async () => {
    if (!discoveryId) {
      addToast('error', 'Run discovery first');
      return;
    }
    
    setLoading('generate');
    setOutput('Generating tests...\n');
    
    try {
      const res = await fetch(`${API_BASE}/generate-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discovery_id: discoveryId })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setOutput(JSON.stringify(data, null, 2));
        addToast('success', `Generated ${data.total_tests} tests`);
      } else {
        throw new Error(data.detail || 'Generation failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setOutput(prev => prev + `\nError: ${msg}`);
      addToast('error', msg);
    } finally {
      setLoading(null);
    }
  };

  const handleRun = async () => {
    if (!discoveryId) {
      addToast('error', 'Run discovery and generate tests first');
      return;
    }
    
    setLoading('run');
    setOutput('Starting test run...\n');
    
    try {
      const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discovery_id: discoveryId,
          test_suite: 'smoke'
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setOutput(prev => prev + `Run started: ${data.run_id}\nStatus: ${data.status}\n`);
        addToast('success', `Run started: ${data.run_id}`);
        
        // Poll for completion
        pollRun(data.run_id);
      } else {
        throw new Error(data.detail || 'Run failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setOutput(prev => prev + `\nError: ${msg}`);
      addToast('error', msg);
    } finally {
      setLoading(null);
    }
  };

  const pollRun = async (runId: string) => {
    const maxAttempts = 120;
    let attempts = 0;
    
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/run/${runId}`);
        const data = await res.json();
        
        setOutput(prev => {
          const lines = prev.split('\n').slice(0, 3);
          return lines.join('\n') + `\n\nStatus: ${data.status}\nPassed: ${data.passed} | Failed: ${data.failed} | Skipped: ${data.skipped}\nCurrent: ${data.current_test || '-'}`;
        });
        
        if (data.status === 'completed' || data.status === 'failed') {
          addToast(data.status === 'completed' ? 'success' : 'error', 
            `Run ${data.status}: ${data.passed} passed, ${data.failed} failed`);
          loadRuns();
          loadReport(runId);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    };
    
    poll();
  };

  const loadRuns = async () => {
    try {
      const res = await fetch(`${API_BASE}/runs`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    }
  };

  const loadReport = async (runId: string) => {
    try {
      const res = await fetch(`${API_BASE}/run/${runId}/report`);
      const data = await res.json();
      setSelectedReport(data);
    } catch (err) {
      console.error('Failed to load report:', err);
    }
  };

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
          <a 
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            API Docs <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Column: Connection + Prompt */}
          <div className="col-span-4 space-y-6">
            
            {/* Panel A: Connection */}
            <div className="panel">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Search className="w-4 h-4" />
                Connection
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="label">Target URL</label>
                  <input
                    type="url"
                    value={connection.ui_url}
                    onChange={e => setConnection(c => ({ ...c, ui_url: e.target.value }))}
                    placeholder="https://your-app.com"
                    className="input"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Username</label>
                    <input
                      type="text"
                      value={connection.username}
                      onChange={e => setConnection(c => ({ ...c, username: e.target.value }))}
                      placeholder="admin"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input
                      type="password"
                      value={connection.password}
                      onChange={e => setConnection(c => ({ ...c, password: e.target.value }))}
                      placeholder="••••••••"
                      className="input"
                      autoComplete="off"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="label">Environment</label>
                  <select
                    value={connection.env}
                    onChange={e => setConnection(c => ({ ...c, env: e.target.value }))}
                    className="input"
                  >
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                
                {connection.env === 'production' && (
                  <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                    ⚠️ Production testing requires ALLOW_PROD=true on the server
                  </p>
                )}
              </div>
            </div>

            {/* Panel B: Prompt */}
            <div className="panel">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                What do you want to test?
              </h2>
              
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe what you want to test...&#10;&#10;Examples:&#10;- Test the login flow with valid and invalid credentials&#10;- Check all API endpoints return proper responses&#10;- Verify form validation on the registration page"
                className="input h-48 resize-none font-mono text-sm"
              />
              
              <p className="text-xs text-gray-500 mt-2">
                This prompt will guide the test generation (coming soon)
              </p>
            </div>
          </div>

          {/* Right Column: Actions + Output */}
          <div className="col-span-8 space-y-6">
            
            {/* Panel C: Actions */}
            <div className="panel">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Actions</h2>
              
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDiscover}
                  disabled={loading !== null}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {loading === 'discover' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Discover
                </button>
                
                <button
                  onClick={handleGenerateTests}
                  disabled={loading !== null || !discoveryId}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  {loading === 'generate' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  Generate Tests
                </button>
                
                <button
                  onClick={handleRun}
                  disabled={loading !== null || !discoveryId}
                  className="btn btn-success flex items-center gap-2"
                >
                  {loading === 'run' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Run Tests
                </button>
                
                <button
                  onClick={loadRuns}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh Runs
                </button>
                
                {/* Copy Curl Dropdown */}
                <div className="relative ml-auto">
                  <button
                    onClick={() => setShowCurl(showCurl ? null : 'discover')}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copy cURL
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  
                  {showCurl && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                      <button
                        onClick={() => {
                          copyToClipboard(getCurl('/discover', {
                            ui_url: connection.ui_url,
                            username: connection.username,
                            password: connection.password
                          }));
                          setShowCurl(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Discover
                      </button>
                      <button
                        onClick={() => {
                          copyToClipboard(getCurl('/generate-tests', { discovery_id: discoveryId || 'YOUR_DISCOVERY_ID' }));
                          setShowCurl(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Generate Tests
                      </button>
                      <button
                        onClick={() => {
                          copyToClipboard(getCurl('/run', { discovery_id: discoveryId || 'YOUR_DISCOVERY_ID', test_suite: 'smoke' }));
                          setShowCurl(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Run Tests
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              {discoveryId && (
                <p className="text-xs text-gray-500 mt-3">
                  Discovery ID: <code className="bg-gray-100 px-1 py-0.5 rounded">{discoveryId}</code>
                </p>
              )}
            </div>

            {/* Output */}
            <div className="panel">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Output</h2>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-auto max-h-64">
                {output || 'No output yet. Click "Discover" to start.'}
              </pre>
            </div>

            {/* Runs Table */}
            <div className="panel">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Test Runs</h2>
              
              {runs.length === 0 ? (
                <p className="text-sm text-gray-500">No runs yet. Click "Run Tests" to start.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Run ID</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Status</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Results</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Started</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <tr key={run.run_id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-xs">{run.run_id}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              run.status === 'completed' ? 'bg-green-100 text-green-800' :
                              run.status === 'failed' ? 'bg-red-100 text-red-800' :
                              run.status === 'running' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-green-600">{run.passed} ✓</span>
                            {' / '}
                            <span className="text-red-600">{run.failed} ✗</span>
                          </td>
                          <td className="py-2 px-3 text-gray-500 text-xs">
                            {new Date(run.started_at).toLocaleString()}
                          </td>
                          <td className="py-2 px-3">
                            <button
                              onClick={() => loadReport(run.run_id)}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              View Report
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
              <div className="panel">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900">
                    Report: {selectedReport.run_id}
                  </h2>
                  <button
                    onClick={() => setSelectedReport(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Summary */}
                <div className="grid grid-cols-5 gap-4 mb-6">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{selectedReport.summary.total}</p>
                    <p className="text-xs text-gray-500">Total</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{selectedReport.summary.passed}</p>
                    <p className="text-xs text-gray-500">Passed</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-2xl font-bold text-red-600">{selectedReport.summary.failed}</p>
                    <p className="text-xs text-gray-500">Failed</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-400">{selectedReport.summary.skipped}</p>
                    <p className="text-xs text-gray-500">Skipped</p>
                  </div>
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-2xl font-bold text-blue-600">{selectedReport.summary.pass_rate}</p>
                    <p className="text-xs text-gray-500">Pass Rate</p>
                  </div>
                </div>
                
                {/* Test Results */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {selectedReport.test_results.map(test => (
                    <TestResultCard key={test.test_id} test={test} />
                  ))}
                </div>
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
            className={`toast-enter flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
              toast.type === 'success' ? 'bg-green-600 text-white' :
              toast.type === 'error' ? 'bg-red-600 text-white' :
              'bg-gray-800 text-white'
            }`}
          >
            {toast.type === 'success' && <Check className="w-4 h-4" />}
            {toast.type === 'error' && <X className="w-4 h-4" />}
            <span className="text-sm">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="ml-2 opacity-70 hover:opacity-100">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Test Result Card Component
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
            test.status === 'failed' ? 'bg-red-500' :
            'bg-gray-400'
          }`} />
          <span className="text-sm font-medium text-gray-900">{test.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{test.duration_ms}ms</span>
          <span className={`text-xs font-medium ${
            test.status === 'passed' ? 'text-green-600' :
            test.status === 'failed' ? 'text-red-600' :
            'text-gray-500'
          }`}>
            {test.status.toUpperCase()}
          </span>
        </div>
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200 mt-1 pt-3">
          {test.error && (
            <p className="text-xs text-red-600 mb-2 font-mono bg-red-100 p-2 rounded">
              Error: {test.error}
            </p>
          )}
          
          <p className="text-xs font-medium text-gray-700 mb-2">Steps:</p>
          <div className="space-y-1">
            {test.steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  step.status === 'passed' ? 'bg-green-500' :
                  step.status === 'failed' ? 'bg-red-500' :
                  'bg-gray-400'
                }`} />
                <span className="text-gray-700">{step.action}</span>
                <span className="text-gray-400">{step.duration_ms}ms</span>
                {step.error && <span className="text-red-500 truncate max-w-xs">{step.error}</span>}
              </div>
            ))}
          </div>
          
          {test.evidence.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-700 mb-1">Evidence:</p>
              <div className="flex flex-wrap gap-1">
                {test.evidence.map((ev, idx) => (
                  <span key={idx} className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
