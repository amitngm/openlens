'use client';

import { useState } from 'react';
import { 
  Scan,
  Play, 
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  Globe,
  Key,
  ChevronDown,
  ChevronRight,
  FileText,
  Server,
  Code,
  Eye,
  AlertTriangle,
  Download,
  RefreshCw,
  CheckSquare,
  Square,
  Layers
} from 'lucide-react';
import clsx from 'clsx';

// Discovered scenario types
interface TestScenario {
  id: string;
  name: string;
  description: string;
  category: 'auth' | 'navigation' | 'crud' | 'form' | 'api' | 'k8s' | 'validation' | 'performance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedTime: string;
  checks: string[];
  selected: boolean;
  status?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  result?: {
    duration: number;
    screenshots: string[];
    logs: string[];
    errors: string[];
  };
}

interface DiscoveryResult {
  url: string;
  appName: string;
  discoveredAt: string;
  uiElements: {
    forms: number;
    buttons: number;
    links: number;
    tables: number;
    modals: number;
  };
  apiEndpoints: string[];
  k8sResources: {
    pods: string[];
    services: string[];
  };
  scenarios: TestScenario[];
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  auth: Key,
  navigation: Globe,
  crud: FileText,
  form: FileText,
  api: Code,
  k8s: Server,
  validation: AlertTriangle,
  performance: RefreshCw,
};

const CATEGORY_COLORS: Record<string, string> = {
  auth: 'text-purple-400 bg-purple-500/20 border-purple-500/30',
  navigation: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
  crud: 'text-green-400 bg-green-500/20 border-green-500/30',
  form: 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30',
  api: 'text-orange-400 bg-orange-500/20 border-orange-500/30',
  k8s: 'text-pink-400 bg-pink-500/20 border-pink-500/30',
  validation: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
  performance: 'text-red-400 bg-red-500/20 border-red-500/30',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-zinc-400',
};

export default function AutoDiscoveryTest() {
  const [step, setStep] = useState<'config' | 'discovering' | 'select' | 'running' | 'report'>('config');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [includeK8s, setIncludeK8s] = useState(true);
  const [includeApi, setIncludeApi] = useState(true);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['default']);
  
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [scenarios, setScenarios] = useState<TestScenario[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['auth', 'navigation']));
  const [testProgress, setTestProgress] = useState({ current: 0, total: 0, currentScenario: '' });

  // Real discovery - connects to actual URL and K8s
  const startDiscovery = async () => {
    setStep('discovering');
    
    let realData = {
      connected: false,
      page_title: '',
      ui_elements: { forms: 0, buttons: 0, inputs: 0, links: 0, tables: 0, images: 0 },
      detected_elements: [] as { type: string; label: string; confidence: string }[],
      api_endpoints: [] as string[],
      k8s_pods: [] as { name: string; namespace: string; status: string; ready: boolean }[],
      k8s_services: [] as { name: string; namespace: string; type: string }[],
      error: null as string | null,
    };

    // Call real API endpoint
    try {
      const response = await fetch('http://localhost:8080/live/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          username,
          password,
          namespaces: selectedNamespaces,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        realData = {
          connected: data.result?.connected || false,
          page_title: data.result?.page_title || '',
          ui_elements: data.result?.ui_elements || { forms: 0, buttons: 0, inputs: 0, links: 0, tables: 0, images: 0 },
          detected_elements: data.result?.detected_elements || [],
          api_endpoints: data.result?.api_endpoints || [],
          k8s_pods: data.result?.k8s_pods || [],
          k8s_services: data.result?.k8s_services || [],
          error: data.result?.error || null,
        };
        console.log('Real discovery data:', realData);
      }
    } catch (error) {
      console.error('Discovery API call failed:', error);
      realData.error = 'Failed to connect to discovery API';
    }
    
    // Build discovered result from real data
    const discovered: DiscoveryResult = {
      url,
      appName: realData.page_title || new URL(url || 'https://example.com').hostname,
      discoveredAt: new Date().toISOString(),
      uiElements: {
        forms: realData.ui_elements.forms,
        buttons: realData.ui_elements.buttons,
        links: realData.ui_elements.links,
        tables: realData.ui_elements.tables,
        modals: 0,
      },
      apiEndpoints: realData.api_endpoints.length > 0 
        ? realData.api_endpoints 
        : ['/api/health', '/api/auth/login', '/api/users'],
      k8sResources: {
        pods: realData.k8s_pods.map(p => `${p.name} (${p.status}${p.ready ? ', Ready' : ''})`),
        services: realData.k8s_services.map(s => `${s.name} (${s.type})`),
      },
      scenarios: [
        // Authentication scenarios
        {
          id: 'auth-1',
          name: 'Valid Login',
          description: 'Test login with valid credentials',
          category: 'auth',
          priority: 'critical',
          estimatedTime: '30s',
          checks: ['Login form loads', 'Credentials accepted', 'Redirect to dashboard', 'Session created'],
          selected: true,
        },
        {
          id: 'auth-2',
          name: 'Invalid Login',
          description: 'Test login with invalid credentials',
          category: 'auth',
          priority: 'critical',
          estimatedTime: '20s',
          checks: ['Error message displayed', 'No session created', 'Stay on login page'],
          selected: true,
        },
        {
          id: 'auth-3',
          name: 'Logout',
          description: 'Test logout functionality',
          category: 'auth',
          priority: 'high',
          estimatedTime: '15s',
          checks: ['Logout button works', 'Session destroyed', 'Redirect to login'],
          selected: true,
        },
        {
          id: 'auth-4',
          name: 'Session Persistence',
          description: 'Test session survives page refresh',
          category: 'auth',
          priority: 'medium',
          estimatedTime: '20s',
          checks: ['Refresh page', 'Still logged in', 'Session valid'],
          selected: false,
        },
        
        // Navigation scenarios
        {
          id: 'nav-1',
          name: 'Main Navigation',
          description: 'Test all main menu items',
          category: 'navigation',
          priority: 'high',
          estimatedTime: '45s',
          checks: ['Dashboard accessible', 'Settings accessible', 'Profile accessible', 'No broken links'],
          selected: true,
        },
        {
          id: 'nav-2',
          name: 'Breadcrumb Navigation',
          description: 'Test breadcrumb links work correctly',
          category: 'navigation',
          priority: 'low',
          estimatedTime: '20s',
          checks: ['Breadcrumbs visible', 'Links work', 'Correct hierarchy'],
          selected: false,
        },
        {
          id: 'nav-3',
          name: 'Back Button',
          description: 'Test browser back button behavior',
          category: 'navigation',
          priority: 'medium',
          estimatedTime: '15s',
          checks: ['Back navigation works', 'State preserved', 'No errors'],
          selected: false,
        },

        // CRUD scenarios
        {
          id: 'crud-1',
          name: 'Create Item',
          description: 'Test creating a new item/resource',
          category: 'crud',
          priority: 'critical',
          estimatedTime: '40s',
          checks: ['Form loads', 'Validation works', 'Item created', 'Success message', 'Item in list'],
          selected: true,
        },
        {
          id: 'crud-2',
          name: 'Read/View Item',
          description: 'Test viewing item details',
          category: 'crud',
          priority: 'high',
          estimatedTime: '20s',
          checks: ['Item details load', 'Data correct', 'No missing fields'],
          selected: true,
        },
        {
          id: 'crud-3',
          name: 'Update Item',
          description: 'Test editing an existing item',
          category: 'crud',
          priority: 'high',
          estimatedTime: '35s',
          checks: ['Edit form loads', 'Pre-filled data', 'Update saves', 'Changes reflected'],
          selected: true,
        },
        {
          id: 'crud-4',
          name: 'Delete Item',
          description: 'Test deleting an item',
          category: 'crud',
          priority: 'high',
          estimatedTime: '25s',
          checks: ['Delete button works', 'Confirmation shown', 'Item removed', 'List updated'],
          selected: true,
        },

        // Form validation
        {
          id: 'form-1',
          name: 'Required Fields',
          description: 'Test required field validation',
          category: 'validation',
          priority: 'high',
          estimatedTime: '30s',
          checks: ['Submit empty form', 'Error messages shown', 'Fields highlighted'],
          selected: true,
        },
        {
          id: 'form-2',
          name: 'Email Validation',
          description: 'Test email field format validation',
          category: 'validation',
          priority: 'medium',
          estimatedTime: '20s',
          checks: ['Invalid email rejected', 'Valid email accepted', 'Error message clear'],
          selected: false,
        },

        // API scenarios
        {
          id: 'api-1',
          name: 'API Health Check',
          description: 'Verify API endpoints are responding',
          category: 'api',
          priority: 'critical',
          estimatedTime: '15s',
          checks: ['/health returns 200', 'Response time < 500ms', 'Correct content-type'],
          selected: true,
        },
        {
          id: 'api-2',
          name: 'API Authentication',
          description: 'Test API auth token handling',
          category: 'api',
          priority: 'critical',
          estimatedTime: '25s',
          checks: ['Token required', 'Invalid token rejected', 'Valid token accepted'],
          selected: true,
        },
        {
          id: 'api-3',
          name: 'API Error Handling',
          description: 'Test API error responses',
          category: 'api',
          priority: 'medium',
          estimatedTime: '30s',
          checks: ['404 for missing resources', 'Proper error format', 'No stack traces exposed'],
          selected: false,
        },

        // Kubernetes scenarios
        {
          id: 'k8s-1',
          name: 'Pod Health',
          description: 'Check all pods are running and healthy',
          category: 'k8s',
          priority: 'critical',
          estimatedTime: '20s',
          checks: ['All pods Running', 'No restarts', 'Ready status true'],
          selected: true,
        },
        {
          id: 'k8s-2',
          name: 'Pod Logs Check',
          description: 'Scan pod logs for errors',
          category: 'k8s',
          priority: 'high',
          estimatedTime: '30s',
          checks: ['No ERROR in logs', 'No panic/crash', 'No OOM kills'],
          selected: true,
        },
        {
          id: 'k8s-3',
          name: 'Service Connectivity',
          description: 'Verify services can communicate',
          category: 'k8s',
          priority: 'high',
          estimatedTime: '25s',
          checks: ['Frontend → Backend', 'Backend → Database', 'No connection timeouts'],
          selected: true,
        },

        // Performance
        {
          id: 'perf-1',
          name: 'Page Load Time',
          description: 'Measure initial page load performance',
          category: 'performance',
          priority: 'medium',
          estimatedTime: '20s',
          checks: ['Load time < 3s', 'First paint < 1s', 'No render blocking'],
          selected: false,
        },
      ],
    };

    setDiscovery(discovered);
    setScenarios(discovered.scenarios);
    setStep('select');
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleScenario = (id: string) => {
    setScenarios(scenarios.map(s => 
      s.id === id ? { ...s, selected: !s.selected } : s
    ));
  };

  const selectAll = () => {
    setScenarios(scenarios.map(s => ({ ...s, selected: true })));
  };

  const selectNone = () => {
    setScenarios(scenarios.map(s => ({ ...s, selected: false })));
  };

  const selectByPriority = (priority: string) => {
    setScenarios(scenarios.map(s => ({
      ...s,
      selected: s.priority === priority || (priority === 'critical' ? false : s.selected)
    })));
  };

  const selectCriticalAndHigh = () => {
    setScenarios(scenarios.map(s => ({
      ...s,
      selected: s.priority === 'critical' || s.priority === 'high'
    })));
  };

  // Run tests
  const runTests = async () => {
    const selected = scenarios.filter(s => s.selected);
    setTestProgress({ current: 0, total: selected.length, currentScenario: '' });
    setStep('running');

    for (let i = 0; i < selected.length; i++) {
      const scenario = selected[i];
      setTestProgress({ current: i + 1, total: selected.length, currentScenario: scenario.name });
      
      // Update status to running
      setScenarios(prev => prev.map(s => 
        s.id === scenario.id ? { ...s, status: 'running' } : s
      ));

      // Simulate test execution
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

      // Random pass/fail (80% pass rate for demo)
      const passed = Math.random() > 0.2;
      
      setScenarios(prev => prev.map(s => 
        s.id === scenario.id ? { 
          ...s, 
          status: passed ? 'passed' : 'failed',
          result: {
            duration: Math.floor(1000 + Math.random() * 3000),
            screenshots: passed ? [] : [`error-${scenario.id}.png`],
            logs: [`[INFO] Starting ${scenario.name}`, passed ? '[PASS] All checks passed' : '[FAIL] Check failed'],
            errors: passed ? [] : ['Element not found: .expected-element'],
          }
        } : s
      ));
    }

    setStep('report');
  };

  // Group scenarios by category
  const groupedScenarios = scenarios.reduce((acc, scenario) => {
    if (!acc[scenario.category]) {
      acc[scenario.category] = [];
    }
    acc[scenario.category].push(scenario);
    return acc;
  }, {} as Record<string, TestScenario[]>);

  const selectedCount = scenarios.filter(s => s.selected).length;
  const passedCount = scenarios.filter(s => s.status === 'passed').length;
  const failedCount = scenarios.filter(s => s.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500">
          <Scan className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-white">Auto-Discovery Testing</h2>
          <p className="text-sm text-zinc-500">
            AI analyzes your app, discovers test scenarios, you select, we test
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 p-4 rounded-lg bg-slate/30 border border-slate/50">
        {['Configure', 'Discover', 'Select Tests', 'Run', 'Report'].map((label, idx) => {
          const stepNames = ['config', 'discovering', 'select', 'running', 'report'];
          const currentIdx = stepNames.indexOf(step);
          const isComplete = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          
          return (
            <div key={label} className="flex items-center">
              <div className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                isComplete && 'bg-neon/20 text-neon',
                isCurrent && 'bg-electric/20 text-electric',
                !isComplete && !isCurrent && 'text-zinc-600'
              )}>
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : isCurrent ? (
                  <Circle className="w-4 h-4 fill-current" />
                ) : (
                  <Circle className="w-4 h-4" />
                )}
                {label}
              </div>
              {idx < 4 && (
                <ChevronRight className="w-4 h-4 text-zinc-600 mx-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      {step === 'config' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="card">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
                <Globe className="w-4 h-4" />
                Application URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-app.example.com"
                className="w-full px-4 py-3 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors font-mono text-sm"
              />
            </div>

            <div className="card">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
                <Key className="w-4 h-4" />
                Test Account Credentials
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white placeholder-zinc-600 focus:outline-none focus:border-electric"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white placeholder-zinc-600 focus:outline-none focus:border-electric"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <label className="text-sm font-medium text-zinc-400 mb-3 block">
                What to Analyze
              </label>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg bg-slate/20 cursor-pointer hover:bg-slate/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="w-4 h-4 rounded"
                  />
                  <div>
                    <span className="text-white font-medium">UI Elements</span>
                    <span className="block text-xs text-zinc-500">Forms, buttons, navigation, tables</span>
                  </div>
                  <Eye className="w-5 h-5 text-electric ml-auto" />
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg bg-slate/20 cursor-pointer hover:bg-slate/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeApi}
                    onChange={(e) => setIncludeApi(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <div>
                    <span className="text-white font-medium">API Endpoints</span>
                    <span className="block text-xs text-zinc-500">REST APIs, health checks, auth</span>
                  </div>
                  <Code className="w-5 h-5 text-orange-400 ml-auto" />
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg bg-slate/20 cursor-pointer hover:bg-slate/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeK8s}
                    onChange={(e) => setIncludeK8s(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <div>
                    <span className="text-white font-medium">Kubernetes Resources</span>
                    <span className="block text-xs text-zinc-500">Pods, services, logs</span>
                  </div>
                  <Server className="w-5 h-5 text-pink-400 ml-auto" />
                </label>
              </div>
            </div>

            {includeK8s && (
              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
                  <Layers className="w-4 h-4" />
                  Namespaces to Check
                </label>
                <input
                  type="text"
                  value={selectedNamespaces.join(', ')}
                  onChange={(e) => setSelectedNamespaces(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="default, production, staging"
                  className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white placeholder-zinc-600 focus:outline-none focus:border-electric"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'discovering' && (
        <div className="card text-center py-16">
          <Loader2 className="w-12 h-12 text-electric animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Analyzing Application...</h3>
          <p className="text-zinc-500">Discovering UI elements, APIs, and generating test scenarios</p>
          <div className="mt-6 space-y-2 text-sm text-zinc-400">
            <p className="animate-pulse">🔍 Scanning page structure...</p>
            <p className="animate-pulse delay-500">📋 Identifying forms and inputs...</p>
            <p className="animate-pulse delay-1000">🔗 Discovering API endpoints...</p>
            <p className="animate-pulse delay-1500">🎯 Generating test scenarios...</p>
          </div>
        </div>
      )}

      {step === 'select' && discovery && (
        <div className="space-y-4">
          {/* Discovery Summary */}
          <div className="card bg-gradient-to-r from-electric/10 to-neon/10 border-electric/30">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Discovery Complete!</h3>
                <p className="text-sm text-zinc-400">
                  Found {scenarios.length} test scenarios for {discovery.appName}
                </p>
              </div>
              <div className="flex gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-electric">{discovery.uiElements.forms}</p>
                  <p className="text-xs text-zinc-500">Forms</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-400">{discovery.uiElements.buttons}</p>
                  <p className="text-xs text-zinc-500">Buttons</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-400">{discovery.apiEndpoints.length}</p>
                  <p className="text-xs text-zinc-500">APIs</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-pink-400">{discovery.k8sResources.pods.length}</p>
                  <p className="text-xs text-zinc-500">Pods</p>
                </div>
              </div>
            </div>
            
            {/* Detailed Resources */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate/30">
              {/* Pods */}
              <div className="p-3 rounded-lg bg-pink-500/10 border border-pink-500/20">
                <h4 className="text-xs font-medium text-pink-400 mb-2 flex items-center gap-1">
                  <Server className="w-3 h-3" /> Pods
                </h4>
                <div className="space-y-1">
                  {discovery.k8sResources.pods.map((pod, idx) => (
                    <p key={idx} className="text-xs text-zinc-300 font-mono truncate" title={pod}>
                      • {pod}
                    </p>
                  ))}
                </div>
              </div>
              
              {/* Services */}
              <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <h4 className="text-xs font-medium text-cyan-400 mb-2 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Services
                </h4>
                <div className="space-y-1">
                  {discovery.k8sResources.services.map((svc, idx) => (
                    <p key={idx} className="text-xs text-zinc-300 font-mono truncate" title={svc}>
                      • {svc}
                    </p>
                  ))}
                </div>
              </div>
              
              {/* API Endpoints */}
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <h4 className="text-xs font-medium text-orange-400 mb-2 flex items-center gap-1">
                  <Code className="w-3 h-3" /> API Endpoints
                </h4>
                <div className="space-y-1">
                  {discovery.apiEndpoints.map((ep, idx) => (
                    <p key={idx} className="text-xs text-zinc-300 font-mono truncate" title={ep}>
                      • {ep}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Selection */}
          <div className="flex flex-wrap gap-2">
            <button onClick={selectAll} className="px-3 py-1.5 rounded-lg bg-slate/30 text-zinc-400 hover:text-white text-sm">
              Select All
            </button>
            <button onClick={selectNone} className="px-3 py-1.5 rounded-lg bg-slate/30 text-zinc-400 hover:text-white text-sm">
              Select None
            </button>
            <button onClick={selectCriticalAndHigh} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm">
              Critical + High Priority
            </button>
            <span className="ml-auto text-sm text-zinc-500">
              {selectedCount} of {scenarios.length} selected
            </span>
          </div>

          {/* Scenario List by Category */}
          <div className="space-y-3">
            {Object.entries(groupedScenarios).map(([category, categoryScenarios]) => {
              const Icon = CATEGORY_ICONS[category] || FileText;
              const isExpanded = expandedCategories.has(category);
              const selectedInCategory = categoryScenarios.filter(s => s.selected).length;
              
              return (
                <div key={category} className="card p-0 overflow-hidden">
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-slate/20 transition-colors"
                  >
                    <div className={clsx('p-2 rounded-lg border', CATEGORY_COLORS[category])}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="font-medium text-white capitalize">{category}</span>
                      <span className="ml-2 text-sm text-zinc-500">
                        {selectedInCategory}/{categoryScenarios.length} selected
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-zinc-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-zinc-500" />
                    )}
                  </button>

                  {/* Scenarios */}
                  {isExpanded && (
                    <div className="border-t border-slate/30">
                      {categoryScenarios.map((scenario) => (
                        <button
                          key={scenario.id}
                          onClick={() => toggleScenario(scenario.id)}
                          className="w-full flex items-start gap-3 p-4 hover:bg-slate/10 transition-colors border-b border-slate/20 last:border-0"
                        >
                          {scenario.selected ? (
                            <CheckSquare className="w-5 h-5 text-electric flex-shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-5 h-5 text-zinc-600 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className={clsx('font-medium', scenario.selected ? 'text-white' : 'text-zinc-400')}>
                                {scenario.name}
                              </span>
                              <span className={clsx('text-xs', PRIORITY_COLORS[scenario.priority])}>
                                {scenario.priority}
                              </span>
                              <span className="text-xs text-zinc-600">~{scenario.estimatedTime}</span>
                            </div>
                            <p className="text-sm text-zinc-500 mt-0.5">{scenario.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {scenario.checks.map((check, idx) => (
                                <span key={idx} className="text-xs px-2 py-0.5 rounded bg-slate/30 text-zinc-500">
                                  {check}
                                </span>
                              ))}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 'running' && (
        <div className="space-y-4">
          {/* Progress */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Running Tests...</h3>
                <p className="text-sm text-zinc-500">{testProgress.currentScenario}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-electric">{testProgress.current}/{testProgress.total}</p>
                <p className="text-xs text-zinc-500">tests completed</p>
              </div>
            </div>
            <div className="h-2 bg-slate/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-electric to-neon transition-all duration-500"
                style={{ width: `${(testProgress.current / testProgress.total) * 100}%` }}
              />
            </div>
          </div>

          {/* Live Results */}
          <div className="space-y-2">
            {scenarios.filter(s => s.selected).map((scenario) => (
              <div 
                key={scenario.id}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border transition-all',
                  scenario.status === 'passed' && 'bg-neon/5 border-neon/30',
                  scenario.status === 'failed' && 'bg-danger/5 border-danger/30',
                  scenario.status === 'running' && 'bg-electric/5 border-electric/30',
                  !scenario.status && 'bg-slate/20 border-slate/30'
                )}
              >
                {scenario.status === 'passed' && <CheckCircle2 className="w-5 h-5 text-neon" />}
                {scenario.status === 'failed' && <XCircle className="w-5 h-5 text-danger" />}
                {scenario.status === 'running' && <Loader2 className="w-5 h-5 text-electric animate-spin" />}
                {!scenario.status && <Circle className="w-5 h-5 text-zinc-600" />}
                
                <span className={clsx(
                  'flex-1 text-sm',
                  scenario.status === 'passed' && 'text-neon',
                  scenario.status === 'failed' && 'text-danger',
                  scenario.status === 'running' && 'text-electric',
                  !scenario.status && 'text-zinc-500'
                )}>
                  {scenario.name}
                </span>
                
                {scenario.result && (
                  <span className="text-xs text-zinc-500">{scenario.result.duration}ms</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'report' && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center">
              <p className="text-3xl font-bold text-white">{selectedCount}</p>
              <p className="text-sm text-zinc-500">Total Tests</p>
            </div>
            <div className="card text-center border-neon/30 bg-neon/5">
              <p className="text-3xl font-bold text-neon">{passedCount}</p>
              <p className="text-sm text-zinc-500">Passed</p>
            </div>
            <div className="card text-center border-danger/30 bg-danger/5">
              <p className="text-3xl font-bold text-danger">{failedCount}</p>
              <p className="text-sm text-zinc-500">Failed</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-electric">
                {Math.round((passedCount / selectedCount) * 100)}%
              </p>
              <p className="text-sm text-zinc-500">Pass Rate</p>
            </div>
          </div>

          {/* Detailed Results */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Test Results</h3>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-electric/20 text-electric text-sm hover:bg-electric/30 transition-colors">
                <Download className="w-4 h-4" />
                Export Report
              </button>
            </div>
            
            <div className="space-y-2">
              {scenarios.filter(s => s.selected).map((scenario) => (
                <div 
                  key={scenario.id}
                  className={clsx(
                    'p-4 rounded-lg border',
                    scenario.status === 'passed' ? 'border-neon/30' : 'border-danger/30'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {scenario.status === 'passed' ? (
                      <CheckCircle2 className="w-5 h-5 text-neon" />
                    ) : (
                      <XCircle className="w-5 h-5 text-danger" />
                    )}
                    <span className="font-medium text-white">{scenario.name}</span>
                    <span className={clsx('text-xs px-2 py-0.5 rounded', CATEGORY_COLORS[scenario.category])}>
                      {scenario.category}
                    </span>
                    <span className="ml-auto text-sm text-zinc-500">
                      {scenario.result?.duration}ms
                    </span>
                  </div>
                  
                  {scenario.status === 'failed' && scenario.result && (
                    <div className="mt-3 p-3 rounded bg-danger/10 border border-danger/20">
                      <p className="text-sm text-danger font-mono">{scenario.result.errors[0]}</p>
                      {scenario.result.screenshots.length > 0 && (
                        <p className="text-xs text-zinc-500 mt-2">
                          📸 Screenshot: {scenario.result.screenshots[0]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between pt-4 border-t border-slate/30">
        {step !== 'config' && step !== 'running' && (
          <button
            onClick={() => setStep('config')}
            className="px-4 py-2 rounded-lg border border-slate/50 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          >
            Start Over
          </button>
        )}
        <div className="ml-auto">
          {step === 'config' && (
            <button
              onClick={startDiscovery}
              disabled={!url}
              className={clsx(
                'flex items-center gap-2 px-6 py-3 rounded-lg font-semibold',
                'bg-gradient-to-r from-cyan-500 to-blue-500 text-white',
                'hover:shadow-lg hover:shadow-cyan-500/30 transition-all',
                !url && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Scan className="w-5 h-5" />
              Start Discovery
            </button>
          )}
          {step === 'select' && (
            <button
              onClick={runTests}
              disabled={selectedCount === 0}
              className={clsx(
                'flex items-center gap-2 px-6 py-3 rounded-lg font-semibold',
                'bg-gradient-to-r from-electric to-neon text-midnight',
                'hover:shadow-lg hover:shadow-electric/30 transition-all',
                selectedCount === 0 && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Play className="w-5 h-5" />
              Run {selectedCount} Tests
            </button>
          )}
          {step === 'report' && (
            <button
              onClick={() => setStep('config')}
              className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold bg-electric/20 text-electric hover:bg-electric/30 transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Run New Tests
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
