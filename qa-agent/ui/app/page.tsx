'use client';

import { useState } from 'react';
import { 
  Search, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Globe,
  FileText,
  Link,
  Image,
  FormInput,
  Play,
  Zap,
  ChevronRight,
  RefreshCw,
  ExternalLink
} from 'lucide-react';

// Simple API call function
const API_BASE = typeof window !== 'undefined' && window.location.port === '3000' 
  ? 'http://localhost:8080' 
  : '';

async function analyzeUrl(url: string) {
  const res = await fetch(`${API_BASE}/qa/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  return res.json();
}

async function runTest(url: string, testType: string, username?: string, password?: string) {
  const res = await fetch(`${API_BASE}/qa/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, test_type: testType, username, password })
  });
  return res.json();
}

async function quickTest(url: string) {
  const res = await fetch(`${API_BASE}/qa/quick-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  return res.json();
}

interface Analysis {
  url: string;
  loaded: boolean;
  status_code: number;
  response_time_ms: number;
  error?: string;
  suggestion?: string;
  page_identity?: {
    title: string;
    description: string;
    technologies: string[];
  };
  elements?: {
    forms: Array<{
      index: number;
      purpose: string;
      fields: Array<{ type: string; name: string; placeholder: string }>;
      field_count: number;
    }>;
    buttons: Array<{ text: string; type: string }>;
    navigation: {
      has_nav: boolean;
      menu_items: Array<{ href: string; text: string }>;
      total_links: number;
    };
    images: {
      total: number;
      with_alt_text: number;
      without_alt_text: number;
      accessibility_score: string;
    };
    headings: Array<{ level: string; text: string }>;
  };
  suggested_tests?: Array<{
    id: string;
    name: string;
    description: string;
    priority: string;
    can_run: boolean;
    requires_credentials?: boolean;
  }>;
}

interface TestResult {
  test_id: string;
  url: string;
  test_type: string;
  passed: boolean;
  summary?: string;
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  error?: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [runningTest, setRunningTest] = useState<string | null>(null);
  const [quickTesting, setQuickTesting] = useState(false);
  const [credentials, setCredentials] = useState({ username: '', password: '' });

  const handleAnalyze = async () => {
    if (!url) return;
    
    setAnalyzing(true);
    setAnalysis(null);
    setTestResults([]);
    
    try {
      const result = await analyzeUrl(url);
      setAnalysis(result);
    } catch (err) {
      setAnalysis({
        url,
        loaded: false,
        status_code: 0,
        response_time_ms: 0,
        error: 'Failed to connect to QA Agent API. Make sure the server is running.'
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRunTest = async (testId: string, requiresCredentials?: boolean) => {
    if (!analysis?.url) return;
    
    setRunningTest(testId);
    
    try {
      const result = await runTest(
        analysis.url, 
        testId,
        requiresCredentials ? credentials.username : undefined,
        requiresCredentials ? credentials.password : undefined
      );
      setTestResults(prev => [...prev.filter(t => t.test_type !== testId), result]);
    } catch (err) {
      console.error('Test failed:', err);
    } finally {
      setRunningTest(null);
    }
  };

  const handleQuickTest = async () => {
    if (!url) return;
    
    setQuickTesting(true);
    setAnalysis(null);
    setTestResults([]);
    
    try {
      const result = await quickTest(url);
      setAnalysis(result.analysis);
      setTestResults(result.tests || []);
    } catch (err) {
      console.error('Quick test failed:', err);
    } finally {
      setQuickTesting(false);
    }
  };

  const getStatusColor = (passed: boolean) => passed ? 'text-green-600' : 'text-red-600';
  const getStatusBg = (passed: boolean) => passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">QA Agent</h1>
                <p className="text-sm text-gray-500">Test any web application</p>
              </div>
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
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* URL Input Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Enter a URL to test
          </h2>
          
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                placeholder="https://example.com"
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !url}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Analyze
                </>
              )}
            </button>
            
            <button
              onClick={handleQuickTest}
              disabled={quickTesting || !url}
              className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {quickTesting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Quick Test
                </>
              )}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mt-3">
            <strong>Analyze</strong> looks at the page and tells you what's there. 
            <strong className="ml-2">Quick Test</strong> runs all recommended tests automatically.
          </p>
        </div>

        {/* Error State */}
        {analysis?.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
            <div className="flex items-start gap-3">
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-800">Cannot access this URL</h3>
                <p className="text-red-700 mt-1">{analysis.error}</p>
                {analysis.suggestion && (
                  <p className="text-red-600 text-sm mt-2">{analysis.suggestion}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {analysis?.loaded && (
          <div className="space-y-6">
            {/* Page Identity */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium text-green-600">
                      Page loaded in {analysis.response_time_ms}ms
                    </span>
                  </div>
                  
                  <h2 className="text-2xl font-bold text-gray-900">
                    {analysis.page_identity?.title || 'Untitled Page'}
                  </h2>
                  
                  {analysis.page_identity?.description && (
                    <p className="text-gray-600 mt-2">{analysis.page_identity.description}</p>
                  )}
                  
                  {analysis.page_identity?.technologies && analysis.page_identity.technologies.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {analysis.page_identity.technologies.map((tech, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                
                <a 
                  href={analysis.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* What I Found */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                What I found on this page
              </h3>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Forms */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <FormInput className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-gray-900">Forms</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {analysis.elements?.forms?.length || 0}
                  </p>
                  {analysis.elements?.forms?.map((form, i) => (
                    <p key={i} className="text-xs text-gray-600 mt-1">• {form.purpose}</p>
                  ))}
                </div>
                
                {/* Links */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Link className="w-5 h-5 text-purple-600" />
                    <span className="font-medium text-gray-900">Links</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {analysis.elements?.navigation?.total_links || 0}
                  </p>
                  {analysis.elements?.navigation?.has_nav && (
                    <p className="text-xs text-gray-600 mt-1">Has navigation menu</p>
                  )}
                </div>
                
                {/* Images */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Image className="w-5 h-5 text-green-600" />
                    <span className="font-medium text-gray-900">Images</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {analysis.elements?.images?.total || 0}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {analysis.elements?.images?.accessibility_score} have alt text
                  </p>
                </div>
                
                {/* Buttons */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-5 h-5 text-orange-600" />
                    <span className="font-medium text-gray-900">Buttons</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {analysis.elements?.buttons?.length || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Suggested Tests */}
            {analysis.suggested_tests && analysis.suggested_tests.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Tests you can run
                </h3>
                
                <div className="space-y-3">
                  {analysis.suggested_tests.map((test) => {
                    const result = testResults.find(r => r.test_type === test.id);
                    const isRunning = runningTest === test.id;
                    
                    return (
                      <div 
                        key={test.id} 
                        className={`p-4 rounded-lg border ${result ? getStatusBg(result.passed) : 'bg-gray-50 border-gray-200'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {result ? (
                              result.passed ? (
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                              ) : (
                                <XCircle className="w-5 h-5 text-red-600" />
                              )
                            ) : (
                              <AlertCircle className="w-5 h-5 text-gray-400" />
                            )}
                            
                            <div>
                              <h4 className="font-medium text-gray-900">{test.name}</h4>
                              <p className="text-sm text-gray-600">{test.description}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            {test.requires_credentials && !result && (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Username"
                                  value={credentials.username}
                                  onChange={(e) => setCredentials(c => ({ ...c, username: e.target.value }))}
                                  className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                                />
                                <input
                                  type="password"
                                  placeholder="Password"
                                  value={credentials.password}
                                  onChange={(e) => setCredentials(c => ({ ...c, password: e.target.value }))}
                                  className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                                />
                              </div>
                            )}
                            
                            <button
                              onClick={() => handleRunTest(test.id, test.requires_credentials)}
                              disabled={isRunning}
                              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isRunning ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Running...
                                </>
                              ) : result ? (
                                <>
                                  <RefreshCw className="w-4 h-4" />
                                  Re-run
                                </>
                              ) : (
                                <>
                                  <Play className="w-4 h-4" />
                                  Run Test
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* Test Result Details */}
                        {result && result.checks && result.checks.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-700 mb-2">{result.summary}</p>
                            <div className="space-y-2">
                              {result.checks.map((check, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  {check.passed ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                                  )}
                                  <span className={check.passed ? 'text-green-700' : 'text-red-700'}>
                                    {check.name}
                                  </span>
                                  <span className="text-gray-500">— {check.detail}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Detailed Elements */}
            {analysis.elements?.forms && analysis.elements.forms.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Forms Found
                </h3>
                
                <div className="space-y-4">
                  {analysis.elements.forms.map((form, i) => (
                    <div key={i} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-gray-900">{form.purpose}</h4>
                        <span className="text-xs text-gray-500">{form.field_count} fields</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form.fields.map((field, j) => (
                          <span key={j} className="px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700">
                            {field.type}: {field.placeholder || field.name || 'unnamed'}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!analyzing && !quickTesting && !analysis && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Globe className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Enter a URL to get started
            </h3>
            <p className="text-gray-600 max-w-md mx-auto">
              I'll look at the page, understand what's there, and suggest tests you can run.
              Just like a human tester would.
            </p>
            
            <div className="mt-8 grid grid-cols-3 gap-6 max-w-2xl mx-auto text-left">
              <div className="p-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                  <Search className="w-5 h-5 text-purple-600" />
                </div>
                <h4 className="font-medium text-gray-900">1. Analyze</h4>
                <p className="text-sm text-gray-600 mt-1">
                  I look at the page and find forms, buttons, links, and more
                </p>
              </div>
              
              <div className="p-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                  <AlertCircle className="w-5 h-5 text-green-600" />
                </div>
                <h4 className="font-medium text-gray-900">2. Suggest</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Based on what I find, I suggest relevant tests
                </p>
              </div>
              
              <div className="p-4">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                  <Play className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="font-medium text-gray-900">3. Test</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Run tests and see clear pass/fail results
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <p className="text-sm text-gray-500 text-center">
            QA Agent v1.0 • Works like a human tester
          </p>
        </div>
      </footer>
    </div>
  );
}
