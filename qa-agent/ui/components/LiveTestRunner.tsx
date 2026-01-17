'use client';

import { useState } from 'react';
import { 
  Play,
  Globe,
  Key,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import clsx from 'clsx';

interface TestResult {
  url: string;
  status: number;
  statusText: string;
  responseTime: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

// Get API base URL dynamically
const getApiBase = (): string => {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '3000') return 'http://localhost:8080';
  return '';
};

export default function LiveTestRunner() {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const testUrl = async () => {
    if (!url) {
      setError('Please enter a URL to test');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call our backend API to test the URL
      const response = await fetch(`${getApiBase()}/live/test-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          username: username || undefined,
          password: password || undefined,
        }),
      });

      const data = await response.json();

      const result: TestResult = {
        url,
        status: data.status_code || 0,
        statusText: data.status_text || 'Unknown',
        responseTime: data.response_time_ms || 0,
        success: data.success || false,
        error: data.error,
        timestamp: new Date().toISOString(),
      };

      setResults(prev => [result, ...prev].slice(0, 20)); // Keep last 20 results
    } catch (err) {
      const result: TestResult = {
        url,
        status: 0,
        statusText: 'Connection Failed',
        responseTime: 0,
        success: false,
        error: err instanceof Error ? err.message : 'Failed to connect to QA Agent API',
        timestamp: new Date().toISOString(),
      };
      setResults(prev => [result, ...prev].slice(0, 20));
      setError('Failed to reach QA Agent API. Make sure it is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const clearResults = () => {
    setResults([]);
    setError(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-hub-text">Live Test Runner</h1>
        <p className="text-sm text-hub-text-muted mt-1">
          Test URLs and endpoints in real-time
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel - Input */}
        <div className="space-y-4">
          {/* URL Input */}
          <div className="card">
            <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-3">
              <Globe className="w-4 h-4 text-hub-blue" />
              Target URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.example.com"
              className="input"
              onKeyDown={(e) => e.key === 'Enter' && testUrl()}
            />
            <p className="text-xs text-hub-text-muted mt-2">
              Enter the URL you want to test (API endpoint or web page)
            </p>
          </div>

          {/* Credentials (Optional) */}
          <div className="card">
            <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-3">
              <Key className="w-4 h-4 text-hub-blue" />
              Credentials (Optional)
            </label>
            <div className="space-y-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username or API Key"
                className="input"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password or Token"
                className="input"
              />
            </div>
            <p className="text-xs text-hub-text-muted mt-2">
              For Basic Auth or Bearer token authentication
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Test Button */}
          <button
            onClick={testUrl}
            disabled={isLoading || !url}
            className={clsx(
              'btn btn-primary w-full py-3 text-base',
              (!url || isLoading) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run Test
              </>
            )}
          </button>
        </div>

        {/* Right Panel - Results */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-hub-text">Test Results</h3>
            {results.length > 0 && (
              <button
                onClick={clearResults}
                className="text-xs text-hub-text-muted hover:text-hub-text flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="py-12 text-center">
              <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-hub-text-muted text-sm">No tests run yet</p>
              <p className="text-hub-text-muted text-xs mt-1">
                Enter a URL and click "Run Test" to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'p-4 rounded-lg border',
                    result.success 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-red-50 border-red-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600" />
                      )}
                      <div>
                        <p className={clsx(
                          'text-sm font-medium',
                          result.success ? 'text-green-800' : 'text-red-800'
                        )}>
                          {result.success ? 'Success' : 'Failed'}
                          {result.status > 0 && ` - ${result.status} ${result.statusText}`}
                        </p>
                        <p className="text-xs text-hub-text-muted truncate max-w-[280px]" title={result.url}>
                          {result.url}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-hub-text">
                        {result.responseTime}ms
                      </p>
                      <p className="text-xs text-hub-text-muted">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  {result.error && (
                    <p className="text-xs text-red-600 mt-2 bg-red-100 p-2 rounded">
                      {result.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="mt-6 card">
        <h3 className="text-sm font-medium text-hub-text mb-3">Quick Test URLs</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Google', url: 'https://www.google.com' },
            { label: 'GitHub API', url: 'https://api.github.com' },
            { label: 'HTTPBin', url: 'https://httpbin.org/get' },
            { label: 'JSON Placeholder', url: 'https://jsonplaceholder.typicode.com/posts/1' },
          ].map((item) => (
            <button
              key={item.url}
              onClick={() => setUrl(item.url)}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-hub-text-muted 
                       hover:bg-hub-blue-light hover:text-hub-blue transition-colors
                       flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
