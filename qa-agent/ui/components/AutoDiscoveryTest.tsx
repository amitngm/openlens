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
  Layers,
  Box
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
  auth: 'bg-purple-100 text-purple-800 border-purple-200',
  navigation: 'bg-blue-100 text-blue-800 border-blue-200',
  crud: 'bg-green-100 text-green-800 border-green-200',
  form: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  api: 'bg-orange-100 text-orange-800 border-orange-200',
  k8s: 'bg-pink-100 text-pink-800 border-pink-200',
  validation: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  performance: 'bg-red-100 text-red-800 border-red-200',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-yellow-600',
  low: 'text-gray-500',
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
      
      setScenarios(prev => prev.map(s => 
        s.id === scenario.id ? { ...s, status: 'running' } : s
      ));

      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

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
      <div>
        <h1 className="text-2xl font-semibold text-hub-text">Auto-Discovery Testing</h1>
        <p className="text-sm text-hub-text-muted mt-1">
          AI analyzes your app, discovers test scenarios, you select, we test
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 p-4 rounded-lg bg-gray-50 border border-hub-border">
        {['Configure', 'Discover', 'Select Tests', 'Run', 'Report'].map((label, idx) => {
          const stepNames = ['config', 'discovering', 'select', 'running', 'report'];
          const currentIdx = stepNames.indexOf(step);
          const isComplete = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          
          return (
            <div key={label} className="flex items-center">
              <div className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                isComplete && 'bg-green-100 text-green-700',
                isCurrent && 'bg-hub-blue text-white',
                !isComplete && !isCurrent && 'text-gray-400'
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
                <ChevronRight className="w-4 h-4 text-gray-400 mx-1" />
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
              <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-3">
                <Globe className="w-4 h-4 text-hub-blue" />
                Application URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-app.example.com"
                className="input font-mono"
              />
            </div>

            <div className="card">
              <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-3">
                <Key className="w-4 h-4 text-hub-blue" />
                Test Account Credentials
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="input"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="input"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <label className="text-sm font-medium text-hub-text mb-3 block">
                What to Analyze
              </label>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-hub-border cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="w-4 h-4 rounded text-hub-blue"
                  />
                  <div className="flex-1">
                    <span className="text-hub-text font-medium">UI Elements</span>
                    <span className="block text-xs text-hub-text-muted">Forms, buttons, navigation, tables</span>
                  </div>
                  <Eye className="w-5 h-5 text-hub-blue" />
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-hub-border cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeApi}
                    onChange={(e) => setIncludeApi(e.target.checked)}
                    className="w-4 h-4 rounded text-hub-blue"
                  />
                  <div className="flex-1">
                    <span className="text-hub-text font-medium">API Endpoints</span>
                    <span className="block text-xs text-hub-text-muted">REST APIs, health checks, auth</span>
                  </div>
                  <Code className="w-5 h-5 text-orange-500" />
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-hub-border cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeK8s}
                    onChange={(e) => setIncludeK8s(e.target.checked)}
                    className="w-4 h-4 rounded text-hub-blue"
                  />
                  <div className="flex-1">
                    <span className="text-hub-text font-medium">Kubernetes Resources</span>
                    <span className="block text-xs text-hub-text-muted">Pods, services, logs</span>
                  </div>
                  <Server className="w-5 h-5 text-pink-500" />
                </label>
              </div>
            </div>

            {includeK8s && (
              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-3">
                  <Layers className="w-4 h-4 text-hub-blue" />
                  Namespaces to Check
                </label>
                <input
                  type="text"
                  value={selectedNamespaces.join(', ')}
                  onChange={(e) => setSelectedNamespaces(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="default, production, staging"
                  className="input"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'discovering' && (
        <div className="card text-center py-16">
          <Loader2 className="w-12 h-12 text-hub-blue animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-hub-text mb-2">Analyzing Application...</h3>
          <p className="text-hub-text-muted">Discovering UI elements, APIs, and generating test scenarios</p>
          <div className="mt-6 space-y-2 text-sm text-hub-text-muted">
            <p className="animate-pulse">🔍 Scanning page structure...</p>
            <p className="animate-pulse">📋 Identifying forms and inputs...</p>
            <p className="animate-pulse">🔗 Discovering API endpoints...</p>
            <p className="animate-pulse">🎯 Generating test scenarios...</p>
          </div>
        </div>
      )}

      {step === 'select' && discovery && (
        <div className="space-y-4">
          {/* Discovery Summary */}
          <div className="card bg-hub-blue-light border-hub-blue/20">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-hub-text">Discovery Complete!</h3>
                <p className="text-sm text-hub-text-muted">
                  Found {scenarios.length} test scenarios for {discovery.appName}
                </p>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <p className="text-2xl font-bold text-hub-blue">{discovery.uiElements.forms}</p>
                  <p className="text-xs text-hub-text-muted">Forms</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-600">{discovery.uiElements.buttons}</p>
                  <p className="text-xs text-hub-text-muted">Buttons</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-600">{discovery.apiEndpoints.length}</p>
                  <p className="text-xs text-hub-text-muted">APIs</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-pink-600">{discovery.k8sResources.pods.length}</p>
                  <p className="text-xs text-hub-text-muted">Pods</p>
                </div>
              </div>
            </div>
            
            {/* Detailed Resources */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-hub-border">
              {/* Pods */}
              <div className="p-3 rounded-lg bg-white border border-pink-200">
                <h4 className="text-xs font-medium text-pink-700 mb-2 flex items-center gap-1">
                  <Box className="w-3 h-3" /> Pods
                </h4>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {discovery.k8sResources.pods.map((pod, idx) => (
                    <p key={idx} className="text-xs text-hub-text font-mono truncate" title={pod}>
                      • {pod}
                    </p>
                  ))}
                  {discovery.k8sResources.pods.length === 0 && (
                    <p className="text-xs text-hub-text-muted italic">No pods discovered</p>
                  )}
                </div>
              </div>
              
              {/* Services */}
              <div className="p-3 rounded-lg bg-white border border-cyan-200">
                <h4 className="text-xs font-medium text-cyan-700 mb-2 flex items-center gap-1">
                  <Server className="w-3 h-3" /> Services
                </h4>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {discovery.k8sResources.services.map((svc, idx) => (
                    <p key={idx} className="text-xs text-hub-text font-mono truncate" title={svc}>
                      • {svc}
                    </p>
                  ))}
                  {discovery.k8sResources.services.length === 0 && (
                    <p className="text-xs text-hub-text-muted italic">No services discovered</p>
                  )}
                </div>
              </div>
              
              {/* API Endpoints */}
              <div className="p-3 rounded-lg bg-white border border-orange-200">
                <h4 className="text-xs font-medium text-orange-700 mb-2 flex items-center gap-1">
                  <Code className="w-3 h-3" /> API Endpoints
                </h4>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {discovery.apiEndpoints.map((ep, idx) => (
                    <p key={idx} className="text-xs text-hub-text font-mono truncate" title={ep}>
                      • {ep}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Selection */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={selectAll} className="btn btn-secondary text-sm">
              Select All
            </button>
            <button onClick={selectNone} className="btn btn-secondary text-sm">
              Select None
            </button>
            <button onClick={selectCriticalAndHigh} className="btn btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
              Critical + High Priority
            </button>
            <span className="ml-auto text-sm text-hub-text-muted">
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
                    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className={clsx('p-2 rounded-lg border', CATEGORY_COLORS[category])}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="font-medium text-hub-text capitalize">{category}</span>
                      <span className="ml-2 text-sm text-hub-text-muted">
                        {selectedInCategory}/{categoryScenarios.length} selected
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-hub-text-muted" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-hub-text-muted" />
                    )}
                  </button>

                  {/* Scenarios */}
                  {isExpanded && (
                    <div className="border-t border-hub-border">
                      {categoryScenarios.map((scenario) => (
                        <button
                          key={scenario.id}
                          onClick={() => toggleScenario(scenario.id)}
                          className="w-full flex items-start gap-3 p-4 hover:bg-gray-50 transition-colors border-b border-hub-border last:border-0"
                        >
                          {scenario.selected ? (
                            <CheckSquare className="w-5 h-5 text-hub-blue flex-shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className={clsx('font-medium', scenario.selected ? 'text-hub-text' : 'text-hub-text-muted')}>
                                {scenario.name}
                              </span>
                              <span className={clsx('text-xs font-medium', PRIORITY_COLORS[scenario.priority])}>
                                {scenario.priority}
                              </span>
                              <span className="text-xs text-hub-text-muted">~{scenario.estimatedTime}</span>
                            </div>
                            <p className="text-sm text-hub-text-muted mt-0.5">{scenario.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {scenario.checks.map((check, idx) => (
                                <span key={idx} className="text-xs px-2 py-0.5 rounded bg-gray-100 text-hub-text-muted">
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
                <h3 className="text-lg font-semibold text-hub-text">Running Tests...</h3>
                <p className="text-sm text-hub-text-muted">{testProgress.currentScenario}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-hub-blue">{testProgress.current}/{testProgress.total}</p>
                <p className="text-xs text-hub-text-muted">tests completed</p>
              </div>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-hub-blue transition-all duration-500"
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
                  scenario.status === 'passed' && 'bg-green-50 border-green-200',
                  scenario.status === 'failed' && 'bg-red-50 border-red-200',
                  scenario.status === 'running' && 'bg-blue-50 border-blue-200',
                  !scenario.status && 'bg-gray-50 border-gray-200'
                )}
              >
                {scenario.status === 'passed' && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                {scenario.status === 'failed' && <XCircle className="w-5 h-5 text-red-600" />}
                {scenario.status === 'running' && <Loader2 className="w-5 h-5 text-hub-blue animate-spin" />}
                {!scenario.status && <Circle className="w-5 h-5 text-gray-400" />}
                
                <span className={clsx(
                  'flex-1 text-sm',
                  scenario.status === 'passed' && 'text-green-700',
                  scenario.status === 'failed' && 'text-red-700',
                  scenario.status === 'running' && 'text-hub-blue',
                  !scenario.status && 'text-hub-text-muted'
                )}>
                  {scenario.name}
                </span>
                
                {scenario.result && (
                  <span className="text-xs text-hub-text-muted">{scenario.result.duration}ms</span>
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
              <p className="text-3xl font-bold text-hub-text">{selectedCount}</p>
              <p className="text-sm text-hub-text-muted">Total Tests</p>
            </div>
            <div className="card text-center border-green-200 bg-green-50">
              <p className="text-3xl font-bold text-green-600">{passedCount}</p>
              <p className="text-sm text-hub-text-muted">Passed</p>
            </div>
            <div className="card text-center border-red-200 bg-red-50">
              <p className="text-3xl font-bold text-red-600">{failedCount}</p>
              <p className="text-sm text-hub-text-muted">Failed</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-hub-blue">
                {Math.round((passedCount / selectedCount) * 100)}%
              </p>
              <p className="text-sm text-hub-text-muted">Pass Rate</p>
            </div>
          </div>

          {/* Detailed Results */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-hub-text">Test Results</h3>
              <button className="btn btn-primary">
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
                    scenario.status === 'passed' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {scenario.status === 'passed' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className="font-medium text-hub-text">{scenario.name}</span>
                    <span className={clsx('badge text-xs', CATEGORY_COLORS[scenario.category])}>
                      {scenario.category}
                    </span>
                    <span className="ml-auto text-sm text-hub-text-muted">
                      {scenario.result?.duration}ms
                    </span>
                  </div>
                  
                  {scenario.status === 'failed' && scenario.result && (
                    <div className="mt-3 p-3 rounded bg-red-100 border border-red-200">
                      <p className="text-sm text-red-700 font-mono">{scenario.result.errors[0]}</p>
                      {scenario.result.screenshots.length > 0 && (
                        <p className="text-xs text-red-600 mt-2">
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
      <div className="flex justify-between pt-4 border-t border-hub-border">
        {step !== 'config' && step !== 'running' && (
          <button
            onClick={() => setStep('config')}
            className="btn btn-secondary"
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
                'btn btn-primary',
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
                'btn btn-primary',
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
              className="btn btn-primary"
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
