'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Globe,
  Code,
  Layout,
  List,
  Clock,
  Download
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

interface DiscoveredPage {
  url: string;
  title: string;
  nav_text?: string;
}

interface DiscoveredApi {
  method: string;
  url: string;
  status?: number;
}

interface ProposedFlow {
  name: string;
  description: string;
  steps?: string[];
}

interface Discovery {
  discovery_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  ui_url?: string;
  env?: string;
  pages?: DiscoveredPage[];
  api_endpoints?: DiscoveredApi[];
  proposed_flows?: ProposedFlow[];
  warnings?: string[];
  error?: string;
  started_at?: string;
  completed_at?: string;
}

interface GeneratedTests {
  discovery_id: string;
  total_tests: number;
  preview: {
    id: string;
    name: string;
    type: string;
    target?: string;
  }[];
  categories: Record<string, number>;
}

interface Run {
  run_id: string;
  discovery_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  passed: number;
  failed: number;
  current_test?: string;
}

interface TestStep {
  action: string;
  status: string;
  duration_ms?: number;
  error?: string;
  screenshot?: string;
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

type WorkflowState = 'idle' | 'discovering' | 'discovered' | 'generating' | 'generated' | 'running' | 'completed';

// =============================================================================
// API Functions (using Next.js API routes - NEVER logs credentials)
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
  // Connection state - NEVER persisted to localStorage/sessionStorage
  const [connection, setConnection] = useState({
    ui_url: '',
    username: '',
    password: '', // In-memory only, never stored
    env: 'staging'
  });
  
  // Prompt state
  const [prompt, setPrompt] = useState('');
  
  // Workflow state
  const [workflowState, setWorkflowState] = useState<WorkflowState>('idle');
  const [isLoading, setIsLoading] = useState(false);
  
  // Discovery state
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  
  // Generated tests state
  const [generatedTests, setGeneratedTests] = useState<GeneratedTests | null>(null);
  
  // Runs state
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  
  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Curl helper
  const [showCurl, setShowCurl] = useState(false);
  
  // Auto-refresh interval ref
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ==========================================================================
  // Auto-refresh running items every 3 seconds
  // ==========================================================================
  
  useEffect(() => {
    const hasRunningItems = runs.some(r => r.status === 'running' || r.status === 'pending');
    
    if (hasRunningItems) {
      refreshIntervalRef.current = setInterval(() => {
        refreshRunningItems();
      }, 3000);
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [runs]);

  const refreshRunningItems = async () => {
    const runningRuns = runs.filter(r => r.status === 'running' || r.status === 'pending');
    
    for (const run of runningRuns) {
      try {
        const data = await apiCall<Run>(`/run/${run.run_id}`);
        setRuns(prev => prev.map(r => r.run_id === data.run_id ? { ...r, ...data } : r));
        
        if (data.status === 'completed' || data.status === 'failed') {
          addToast(
            data.status === 'completed' ? 'success' : 'error',
            `Run ${data.status}`,
            `${data.passed} passed, ${data.failed} failed`
          );
          
          if (selectedRunId === data.run_id) {
            loadReport(data.run_id);
            loadArtifacts(data.run_id);
          }
        }
      } catch (err) {
        // Silently handle polling errors
      }
    }
  };

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
  // Curl Command Generator (password redacted)
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
  // Workflow Button State Helpers
  // ==========================================================================
  
  const canDiscover = !isLoading && connection.ui_url.trim() !== '';
  const canGenerateTests = !isLoading && discoveryId !== null && discovery?.status === 'completed';
  const canRunTests = !isLoading && discoveryId !== null && generatedTests !== null;

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  const handleDiscover = async () => {
    if (!connection.ui_url) {
      addToast('warning', 'URL Required', 'Please enter a target URL');
      return;
    }
    
    setIsLoading(true);
    setWorkflowState('discovering');
    setDiscovery(null);
    setGeneratedTests(null);
    
    try {
      const data = await apiCall<{ discovery_id: string; status: string }>('/discover', {
        method: 'POST',
        body: JSON.stringify({
          ui_url: connection.ui_url,
          username: connection.username,
          password: connection.password, // Sent securely, never logged
          env: connection.env,
          prompt: prompt || undefined
        })
      });
      
      setDiscoveryId(data.discovery_id);
      addToast('success', 'Discovery Started', `ID: ${data.discovery_id}`);
      
      pollDiscovery(data.discovery_id);
      
    } catch (error) {
      showError(error);
      setWorkflowState('idle');
      setIsLoading(false);
    }
  };

  const pollDiscovery = async (id: string) => {
    let attempts = 0;
    const maxAttempts = 120;
    
    const poll = async () => {
      try {
        const data = await apiCall<Discovery>(`/discover/${id}`);
        setDiscovery(data);
        
        if (data.status === 'completed') {
          setWorkflowState('discovered');
          setIsLoading(false);
          addToast('success', 'Discovery Completed', 
            `Found ${data.pages?.length || 0} pages, ${data.api_endpoints?.length || 0} APIs`);
        } else if (data.status === 'failed') {
          setWorkflowState('idle');
          setIsLoading(false);
          addToast('error', 'Discovery Failed', data.error);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        } else {
          setWorkflowState('idle');
          setIsLoading(false);
          addToast('error', 'Discovery Timeout', 'Discovery took too long');
        }
      } catch (error) {
        setWorkflowState('idle');
        setIsLoading(false);
        showError(error);
      }
    };
    
    poll();
  };

  const handleGenerateTests = async () => {
    if (!discoveryId) {
      addToast('warning', 'No Discovery', 'Run discovery first');
      return;
    }
    
    setIsLoading(true);
    setWorkflowState('generating');
    
    try {
      const data = await apiCall<GeneratedTests>('/generate-tests', {
        method: 'POST',
        body: JSON.stringify({ discovery_id: discoveryId })
      });
      
      setGeneratedTests(data);
      setWorkflowState('generated');
      addToast('success', 'Tests Generated', `${data.total_tests} tests created`);
      
    } catch (error) {
      showError(error);
      setWorkflowState('discovered');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRun = async () => {
    if (!discoveryId) {
      addToast('warning', 'No Discovery', 'Run discovery and generate tests first');
      return;
    }
    
    setIsLoading(true);
    setWorkflowState('running');
    
    try {
      const data = await apiCall<{ run_id: string; status: string }>('/run', {
        method: 'POST',
        body: JSON.stringify({
          discovery_id: discoveryId,
          suite: 'smoke',
          prompt: prompt || undefined
        })
      });
      
      const newRun: Run = {
        run_id: data.run_id,
        discovery_id: discoveryId,
        status: 'running',
        started_at: new Date().toISOString(),
        passed: 0,
        failed: 0
      };
      
      setRuns(prev => [newRun, ...prev]);
      setSelectedRunId(data.run_id);
      addToast('success', 'Run Started', `ID: ${data.run_id}`);
      
    } catch (error) {
      showError(error);
      setWorkflowState('generated');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRuns = async () => {
    try {
      const data = await apiCall<{ runs: Run[] }>('/run');
      setRuns(data.runs || []);
    } catch (error) {
      // Silently handle - runs might not exist yet
    }
  };

  const loadReport = async (runId: string) => {
    try {
      const data = await apiCall<Report>(`/run/${runId}`);
      setSelectedReport(data);
    } catch (error) {
      showError(error);
    }
  };

  const loadArtifacts = async (runId: string) => {
    try {
      const data = await apiCall<{ artifacts: Artifact[] }>(`/run/${runId}/artifacts`);
      setArtifacts(data.artifacts || []);
    } catch (error) {
      // Silently handle - artifacts might not exist
    }
  };

  const selectRun = (runId: string) => {
    setSelectedRunId(runId);
    loadReport(runId);
    loadArtifacts(runId);
  };

  // Load runs on mount
  useEffect(() => {
    loadRuns();
  }, []);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">QA Agent</h1>
              <p className="text-xs text-slate-500">Intelligent Test Discovery & Execution</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <WorkflowIndicator state={workflowState} isLoading={isLoading} />
            <a 
              href="http://localhost:8080/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              API Docs <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Column - Connection & Prompt */}
          <div className="col-span-4 space-y-6">
            
            {/* Connection Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-500" />
                Target Application
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">URL</label>
                  <input
                    type="url"
                    value={connection.ui_url}
                    onChange={e => setConnection(c => ({ ...c, ui_url: e.target.value }))}
                    placeholder="https://your-app.com"
                    disabled={isLoading}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                    <input
                      type="text"
                      value={connection.username}
                      onChange={e => setConnection(c => ({ ...c, username: e.target.value }))}
                      placeholder="admin"
                      disabled={isLoading}
                      autoComplete="off"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                    <input
                      type="password"
                      value={connection.password}
                      onChange={e => setConnection(c => ({ ...c, password: e.target.value }))}
                      placeholder="••••••••"
                      disabled={isLoading}
                      autoComplete="new-password"
                      data-lpignore="true"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Environment</label>
                  <select
                    value={connection.env}
                    onChange={e => setConnection(c => ({ ...c, env: e.target.value }))}
                    disabled={isLoading}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
                  >
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                
                {connection.env === 'production' && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                    <span>Production testing requires <code className="bg-amber-100 px-1 rounded">ALLOW_PROD=true</code> on the backend</span>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                Test Instructions
              </h2>
              
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                disabled={isLoading}
                placeholder="Describe what you want to test...&#10;&#10;Examples:&#10;• Focus on authentication flows&#10;• Test all CRUD operations&#10;• Check form validations"
                className="w-full h-36 px-3 py-2.5 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
              />
            </div>

            {/* Actions Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Workflow</h2>
              
              <div className="space-y-3">
                {/* Step 1: Discover */}
                <WorkflowButton
                  step={1}
                  label="Discover"
                  description="Crawl application, find pages & APIs"
                  icon={<Search className="w-4 h-4" />}
                  onClick={handleDiscover}
                  disabled={!canDiscover}
                  loading={workflowState === 'discovering'}
                  completed={discovery?.status === 'completed'}
                  active={workflowState === 'idle' || workflowState === 'discovering'}
                />
                
                {/* Step 2: Generate Tests */}
                <WorkflowButton
                  step={2}
                  label="Generate Tests"
                  description="Create smoke tests from discovery"
                  icon={<FileText className="w-4 h-4" />}
                  onClick={handleGenerateTests}
                  disabled={!canGenerateTests}
                  loading={workflowState === 'generating'}
                  completed={generatedTests !== null}
                  active={workflowState === 'discovered' || workflowState === 'generating'}
                />
                
                {/* Step 3: Run Tests */}
                <WorkflowButton
                  step={3}
                  label="Run Tests"
                  description="Execute tests and collect results"
                  icon={<Play className="w-4 h-4" />}
                  onClick={handleRun}
                  disabled={!canRunTests}
                  loading={workflowState === 'running'}
                  completed={workflowState === 'completed'}
                  active={workflowState === 'generated' || workflowState === 'running'}
                  variant="primary"
                />
              </div>
              
              {/* cURL Helper */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="relative">
                  <button
                    onClick={() => setShowCurl(!showCurl)}
                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    Copy cURL command
                    <ChevronDown className={`w-3 h-3 transition-transform ${showCurl ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showCurl && (
                    <div className="absolute left-0 bottom-full mb-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                      {[
                        { name: 'Discover', endpoint: '/discover', body: { ui_url: connection.ui_url, username: connection.username, password: connection.password, env: connection.env, prompt } },
                        { name: 'Generate Tests', endpoint: '/generate-tests', body: { discovery_id: discoveryId || 'DISCOVERY_ID' } },
                        { name: 'Run', endpoint: '/run', body: { discovery_id: discoveryId || 'DISCOVERY_ID', suite: 'smoke', prompt } },
                      ].map(({ name, endpoint, body }) => (
                        <button
                          key={name}
                          onClick={() => { copyToClipboard(getCurl(endpoint, body)); setShowCurl(false); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {discoveryId && (
                  <p className="text-xs text-slate-500 mt-2">
                    Discovery: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">{discoveryId}</code>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Output */}
          <div className="col-span-8 space-y-6">
            
            {/* Discovery Output */}
            {discovery && (
              <DiscoveryOutput discovery={discovery} />
            )}
            
            {/* Generated Tests */}
            {generatedTests && (
              <GeneratedTestsOutput tests={generatedTests} />
            )}

            {/* Runs Table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <List className="w-4 h-4 text-indigo-500" />
                  Test Runs
                </h2>
                <button
                  onClick={loadRuns}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              </div>
              
              {runs.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  No test runs yet. Complete the workflow above to run tests.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="py-3 px-5 font-medium text-slate-600">Run ID</th>
                        <th className="py-3 px-5 font-medium text-slate-600">Status</th>
                        <th className="py-3 px-5 font-medium text-slate-600">Results</th>
                        <th className="py-3 px-5 font-medium text-slate-600">Started</th>
                        <th className="py-3 px-5 font-medium text-slate-600"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runs.map(run => (
                        <tr 
                          key={run.run_id} 
                          className={`hover:bg-slate-50 cursor-pointer transition-colors ${selectedRunId === run.run_id ? 'bg-indigo-50' : ''}`}
                          onClick={() => selectRun(run.run_id)}
                        >
                          <td className="py-3 px-5 font-mono text-xs">{run.run_id.slice(0, 8)}...</td>
                          <td className="py-3 px-5">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="py-3 px-5">
                            <span className="text-emerald-600 font-medium">{run.passed}✓</span>
                            {' / '}
                            <span className="text-red-600 font-medium">{run.failed}✗</span>
                          </td>
                          <td className="py-3 px-5 text-slate-500 text-xs">
                            {new Date(run.started_at).toLocaleString()}
                          </td>
                          <td className="py-3 px-5">
                            {(run.status === 'running' || run.status === 'pending') && (
                              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                            )}
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
              <ReportViewer report={selectedReport} onClose={() => setSelectedReport(null)} />
            )}

            {/* Artifacts Viewer */}
            {artifacts.length > 0 && selectedRunId && (
              <ArtifactsViewer artifacts={artifacts} runId={selectedRunId} />
            )}
          </div>
        </div>
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg max-w-sm backdrop-blur-sm ${
              toast.type === 'success' ? 'bg-emerald-600/95 text-white' :
              toast.type === 'error' ? 'bg-red-600/95 text-white' :
              toast.type === 'warning' ? 'bg-amber-500/95 text-white' :
              'bg-slate-800/95 text-white'
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
// Workflow Indicator Component
// =============================================================================

function WorkflowIndicator({ state, isLoading }: { state: WorkflowState; isLoading: boolean }) {
  const steps = [
    { key: 'discovering', label: 'Discover' },
    { key: 'generating', label: 'Generate' },
    { key: 'running', label: 'Run' },
  ];
  
  const getStepStatus = (stepKey: string) => {
    if (state === 'idle') return 'pending';
    if (state === stepKey) return 'active';
    
    const stateOrder = ['idle', 'discovering', 'discovered', 'generating', 'generated', 'running', 'completed'];
    const currentIndex = stateOrder.indexOf(state);
    const stepIndex = stateOrder.indexOf(stepKey);
    
    if (stepIndex < currentIndex) return 'completed';
    return 'pending';
  };
  
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const status = getStepStatus(step.key);
        return (
          <div key={step.key} className="flex items-center">
            <div className={`w-2 h-2 rounded-full ${
              status === 'completed' ? 'bg-emerald-500' :
              status === 'active' ? 'bg-indigo-500 animate-pulse' :
              'bg-slate-300'
            }`} />
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 mx-1 ${
                status === 'completed' ? 'bg-emerald-500' : 'bg-slate-200'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Workflow Button Component
// =============================================================================

interface WorkflowButtonProps {
  step: number;
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  completed: boolean;
  active: boolean;
  variant?: 'default' | 'primary';
}

function WorkflowButton({ step, label, description, icon, onClick, disabled, loading, completed, active, variant = 'default' }: WorkflowButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
        disabled ? 'opacity-50 cursor-not-allowed' :
        variant === 'primary' ? 'bg-indigo-600 text-white hover:bg-indigo-700' :
        active ? 'bg-slate-100 hover:bg-slate-200' : 'hover:bg-slate-50'
      } ${completed ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        completed ? 'bg-emerald-100 text-emerald-600' :
        loading ? 'bg-indigo-100 text-indigo-600' :
        variant === 'primary' && !disabled ? 'bg-white/20 text-white' :
        'bg-slate-100 text-slate-600'
      }`}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> :
         completed ? <CheckCircle2 className="w-4 h-4" /> :
         icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${variant === 'primary' && !disabled ? 'text-white' : 'text-slate-900'}`}>
          {step}. {label}
        </p>
        <p className={`text-xs truncate ${variant === 'primary' && !disabled ? 'text-white/70' : 'text-slate-500'}`}>
          {description}
        </p>
      </div>
      {completed && (
        <Check className="w-4 h-4 text-emerald-500" />
      )}
    </button>
  );
}

// =============================================================================
// Status Badge Component
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle2 },
    failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
    running: { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: Loader2 },
    pending: { bg: 'bg-slate-100', text: 'text-slate-700', icon: Clock },
  }[status] || { bg: 'bg-slate-100', text: 'text-slate-700', icon: Clock };
  
  const Icon = config.icon;
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}

// =============================================================================
// Discovery Output Component
// =============================================================================

function DiscoveryOutput({ discovery }: { discovery: Discovery }) {
  const [expandedSection, setExpandedSection] = useState<string | null>('pages');
  
  if (discovery.status === 'running' || discovery.status === 'pending') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
          <div>
            <p className="text-sm font-medium text-slate-900">Discovering {discovery.ui_url}...</p>
            <p className="text-xs text-slate-500">Crawling pages, capturing API calls</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (discovery.status === 'failed') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Discovery Failed</p>
            <p className="text-xs text-red-600 mt-1">{discovery.error || 'Unknown error occurred'}</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Search className="w-4 h-4 text-indigo-500" />
          Discovery Results
        </h2>
        <span className="text-xs text-slate-500">{discovery.discovery_id}</span>
      </div>
      
      {/* Warnings */}
      {discovery.warnings && discovery.warnings.length > 0 && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
          {discovery.warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
      
      <div className="p-5 space-y-4">
        {/* Discovered Modules/Pages as Chips */}
        <div>
          <button 
            onClick={() => setExpandedSection(expandedSection === 'pages' ? null : 'pages')}
            className="w-full flex items-center justify-between text-left mb-2"
          >
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-2">
              <Layout className="w-3.5 h-3.5" />
              Discovered Pages ({discovery.pages?.length || 0})
            </span>
            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSection === 'pages' ? 'rotate-90' : ''}`} />
          </button>
          
          {expandedSection === 'pages' && (
            <div className="flex flex-wrap gap-2">
              {discovery.pages?.map((page, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium"
                  title={page.url}
                >
                  <Globe className="w-3 h-3" />
                  {page.title || page.nav_text || new URL(page.url).pathname}
                </span>
              ))}
              {(!discovery.pages || discovery.pages.length === 0) && (
                <span className="text-xs text-slate-500">No pages discovered</span>
              )}
            </div>
          )}
        </div>
        
        {/* API Endpoints Table */}
        <div>
          <button 
            onClick={() => setExpandedSection(expandedSection === 'apis' ? null : 'apis')}
            className="w-full flex items-center justify-between text-left mb-2"
          >
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-2">
              <Code className="w-3.5 h-3.5" />
              API Endpoints ({discovery.api_endpoints?.length || 0})
            </span>
            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSection === 'apis' ? 'rotate-90' : ''}`} />
          </button>
          
          {expandedSection === 'apis' && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="py-2 px-3 text-left font-medium text-slate-600 w-20">Method</th>
                    <th className="py-2 px-3 text-left font-medium text-slate-600">URL</th>
                    <th className="py-2 px-3 text-left font-medium text-slate-600 w-16">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {discovery.api_endpoints?.slice(0, 20).map((api, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${
                          api.method === 'GET' ? 'bg-emerald-100 text-emerald-700' :
                          api.method === 'POST' ? 'bg-blue-100 text-blue-700' :
                          api.method === 'PUT' ? 'bg-amber-100 text-amber-700' :
                          api.method === 'DELETE' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {api.method}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 truncate max-w-xs" title={api.url}>
                        {api.url}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{api.status || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(discovery.api_endpoints?.length || 0) > 20 && (
                <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500 text-center">
                  +{(discovery.api_endpoints?.length || 0) - 20} more endpoints
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Proposed Flows */}
        {discovery.proposed_flows && discovery.proposed_flows.length > 0 && (
          <div>
            <button 
              onClick={() => setExpandedSection(expandedSection === 'flows' ? null : 'flows')}
              className="w-full flex items-center justify-between text-left mb-2"
            >
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                <List className="w-3.5 h-3.5" />
                Proposed Test Flows ({discovery.proposed_flows.length})
              </span>
              <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSection === 'flows' ? 'rotate-90' : ''}`} />
            </button>
            
            {expandedSection === 'flows' && (
              <div className="space-y-2">
                {discovery.proposed_flows.map((flow, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm font-medium text-slate-900">{flow.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{flow.description}</p>
                    {flow.steps && flow.steps.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {flow.steps.map((step, j) => (
                          <span key={j} className="text-xs bg-white px-2 py-0.5 rounded border border-slate-200">
                            {j + 1}. {step}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Generated Tests Output Component
// =============================================================================

function GeneratedTestsOutput({ tests }: { tests: GeneratedTests }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-500" />
          Generated Tests
        </h2>
        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-medium">
          {tests.total_tests} tests
        </span>
      </div>
      
      <div className="p-5">
        {/* Categories */}
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(tests.categories || {}).map(([category, count]) => (
            <span
              key={category}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-xs font-medium"
            >
              {category}
              <span className="bg-slate-200 px-1.5 py-0.5 rounded-full text-slate-600">{count}</span>
            </span>
          ))}
        </div>
        
        {/* Preview */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {tests.preview?.slice(0, 10).map((test) => (
            <div key={test.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              <span className={`w-2 h-2 rounded-full ${
                test.type === 'smoke' ? 'bg-emerald-500' :
                test.type === 'validation' ? 'bg-amber-500' :
                test.type === 'permission' ? 'bg-purple-500' :
                'bg-slate-400'
              }`} />
              <span className="text-sm text-slate-700 flex-1 truncate">{test.name}</span>
              <span className="text-xs text-slate-500">{test.type}</span>
            </div>
          ))}
          {(tests.preview?.length || 0) > 10 && (
            <p className="text-xs text-slate-500 text-center py-2">
              +{(tests.preview?.length || 0) - 10} more tests
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Report Viewer Component
// =============================================================================

function ReportViewer({ report, onClose }: { report: Report; onClose: () => void }) {
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  
  const toggleTest = (testId: string) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-500" />
          Test Report
        </h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 p-5 bg-slate-50 border-b border-slate-100">
        {[
          { label: 'Total', value: report.summary.total, bg: 'bg-white', color: 'text-slate-900' },
          { label: 'Passed', value: report.summary.passed, bg: 'bg-emerald-50', color: 'text-emerald-600' },
          { label: 'Failed', value: report.summary.failed, bg: 'bg-red-50', color: 'text-red-600' },
          { label: 'Pass Rate', value: report.summary.pass_rate, bg: 'bg-indigo-50', color: 'text-indigo-600' },
        ].map(({ label, value, bg, color }) => (
          <div key={label} className={`text-center p-3 rounded-lg ${bg}`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      
      {/* Test Results */}
      <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
        {report.test_results?.map(test => (
          <div key={test.test_id} className="hover:bg-slate-50">
            <button
              onClick={() => toggleTest(test.test_id)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedTests.has(test.test_id) ? 'rotate-90' : ''}`} />
                <span className={`w-2.5 h-2.5 rounded-full ${
                  test.status === 'passed' ? 'bg-emerald-500' :
                  test.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'
                }`} />
                <span className="text-sm font-medium text-slate-900">{test.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{test.duration_ms}ms</span>
                <StatusBadge status={test.status} />
              </div>
            </button>
            
            {expandedTests.has(test.test_id) && (
              <div className="px-4 pb-4 pl-12">
                {test.error && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs text-red-700 font-mono">{test.error}</p>
                  </div>
                )}
                
                <p className="text-xs font-semibold text-slate-600 mb-2">Steps:</p>
                <div className="space-y-1.5">
                  {test.steps?.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        step.status === 'passed' ? 'bg-emerald-500' :
                        step.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'
                      }`} />
                      <span className="text-slate-700 flex-1">{step.action}</span>
                      {step.duration_ms && <span className="text-slate-400">{step.duration_ms}ms</span>}
                    </div>
                  ))}
                </div>
                
                {test.evidence?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-slate-600 mb-1.5">Evidence:</p>
                    <div className="flex flex-wrap gap-1">
                      {test.evidence.map((ev, idx) => (
                        <span key={idx} className="text-xs bg-slate-100 px-2 py-1 rounded">{ev}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Artifacts Viewer Component
// =============================================================================

function ArtifactsViewer({ artifacts, runId }: { artifacts: Artifact[]; runId: string }) {
  const screenshots = artifacts.filter(a => a.type === 'image');
  const reports = artifacts.filter(a => a.type === 'json' || a.name.endsWith('.json'));
  const other = artifacts.filter(a => a.type !== 'image' && !a.name.endsWith('.json'));
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-indigo-500" />
          Artifacts
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{artifacts.length} files</span>
        </h2>
      </div>
      
      <div className="p-5 space-y-4">
        {/* Screenshots */}
        {screenshots.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5" />
              Screenshots ({screenshots.length})
            </p>
            <div className="grid grid-cols-4 gap-3">
              {screenshots.map(artifact => (
                <a
                  key={artifact.name}
                  href={artifact.proxy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-video bg-slate-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-indigo-500"
                >
                  <img 
                    src={artifact.proxy_url} 
                    alt={artifact.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ExternalLink className="w-5 h-5 text-white" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                    <p className="text-xs text-white truncate">{artifact.name}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
        
        {/* Reports */}
        {reports.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              Reports ({reports.length})
            </p>
            <div className="space-y-2">
              {reports.map(artifact => (
                <a
                  key={artifact.name}
                  href={artifact.proxy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <FileText className="w-5 h-5 text-indigo-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{artifact.name}</p>
                    <p className="text-xs text-slate-500">{formatBytes(artifact.size)}</p>
                  </div>
                  <Download className="w-4 h-4 text-slate-400" />
                </a>
              ))}
            </div>
          </div>
        )}
        
        {/* Other files */}
        {other.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Other Files ({other.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {other.map(artifact => (
                <a
                  key={artifact.name}
                  href={artifact.proxy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-700 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {artifact.name}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
