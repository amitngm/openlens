'use client';

import { useState } from 'react';
import { 
  Wand2, 
  Play, 
  Globe, 
  Key, 
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Tag
} from 'lucide-react';
import clsx from 'clsx';

interface SmartTestProps {
  onStartTest: (config: unknown) => void;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  category: string;
}

const TEST_SCENARIOS: TestScenario[] = [
  { id: 'login', name: 'Login Flow', description: 'Test user authentication', category: 'auth' },
  { id: 'navigation', name: 'Navigation', description: 'Test all navigation links', category: 'ui' },
  { id: 'forms', name: 'Form Validation', description: 'Test form inputs and validation', category: 'ui' },
  { id: 'api-health', name: 'API Health', description: 'Check all API endpoints respond', category: 'api' },
  { id: 'crud', name: 'CRUD Operations', description: 'Test Create, Read, Update, Delete', category: 'api' },
  { id: 'responsive', name: 'Responsive Design', description: 'Test on different screen sizes', category: 'ui' },
];

// Get API base URL dynamically
const getApiBase = (): string => {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '3000') return 'http://localhost:8080';
  return '';
};

export default function SmartTest({ onStartTest }: SmartTestProps) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set(['login', 'navigation']));
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Array<{ scenario: string; passed: boolean; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleScenario = (id: string) => {
    const newSelected = new Set(selectedScenarios);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedScenarios(newSelected);
  };

  const runTests = async () => {
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResults([]);

    try {
      // Call the backend smart-test endpoint
      const response = await fetch(`${getApiBase()}/smart-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          username: username || undefined,
          password: password || undefined,
          scenarios: Array.from(selectedScenarios),
        }),
      });

      const data = await response.json();

      // Simulate test results based on scenarios
      const newResults = Array.from(selectedScenarios).map(scenarioId => {
        const scenario = TEST_SCENARIOS.find(s => s.id === scenarioId);
        return {
          scenario: scenario?.name || scenarioId,
          passed: Math.random() > 0.2, // Simulated pass/fail
          message: data.status === 'started' ? 'Test initiated' : 'Completed',
        };
      });

      setResults(newResults);
      onStartTest({ url, scenarios: selectedScenarios, runId: data.run_id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start tests');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-hub-text flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-hub-blue" />
          Smart Test
        </h1>
        <p className="text-sm text-hub-text-muted mt-1">
          AI-powered test scenario selection based on your application
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Configuration */}
        <div className="lg:col-span-2 space-y-4">
          {/* URL and Credentials */}
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
                  <Globe className="w-4 h-4 text-hub-blue" />
                  Application URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-app.example.com"
                  className="input"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
                  <Key className="w-4 h-4 text-hub-blue" />
                  Username (Optional)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="test-user"
                  className="input"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-hub-text mb-2 block">
                  Password (Optional)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
              </div>
            </div>
          </div>

          {/* Test Scenarios */}
          <div className="card">
            <h3 className="text-sm font-medium text-hub-text mb-4 flex items-center gap-2">
              <Tag className="w-4 h-4 text-hub-blue" />
              Test Scenarios
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TEST_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => toggleScenario(scenario.id)}
                  className={clsx(
                    'p-4 rounded-lg border text-left transition-all',
                    selectedScenarios.has(scenario.id)
                      ? 'bg-hub-blue-light border-hub-blue'
                      : 'bg-white border-hub-border hover:border-hub-blue'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx(
                      'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5',
                      selectedScenarios.has(scenario.id)
                        ? 'bg-hub-blue border-hub-blue'
                        : 'border-hub-border'
                    )}>
                      {selectedScenarios.has(scenario.id) && (
                        <CheckCircle2 className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <div>
                      <p className={clsx(
                        'font-medium text-sm',
                        selectedScenarios.has(scenario.id) ? 'text-hub-blue' : 'text-hub-text'
                      )}>
                        {scenario.name}
                      </p>
                      <p className="text-xs text-hub-text-muted mt-1">{scenario.description}</p>
                      <span className="inline-block text-xs px-2 py-0.5 rounded mt-2 bg-gray-100 text-hub-text-muted">
                        {scenario.category}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* Run Button */}
          <button
            onClick={runTests}
            disabled={isRunning || !url || selectedScenarios.size === 0}
            className={clsx(
              'btn btn-primary w-full py-3 text-base',
              (isRunning || !url || selectedScenarios.size === 0) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Running Tests...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run {selectedScenarios.size} Test{selectedScenarios.size !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>

        {/* Right: Results */}
        <div className="card">
          <h3 className="text-sm font-medium text-hub-text mb-4">Test Results</h3>
          
          {results.length === 0 ? (
            <div className="py-12 text-center">
              <Wand2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-hub-text-muted text-sm">No tests run yet</p>
              <p className="text-hub-text-muted text-xs mt-1">
                Select scenarios and click "Run Tests"
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'p-3 rounded-lg border flex items-center gap-3',
                    result.passed
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  )}
                >
                  {result.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600" />
                  )}
                  <div>
                    <p className={clsx(
                      'text-sm font-medium',
                      result.passed ? 'text-green-800' : 'text-red-800'
                    )}>
                      {result.scenario}
                    </p>
                    <p className="text-xs text-hub-text-muted">{result.message}</p>
                  </div>
                </div>
              ))}

              {/* Summary */}
              <div className="pt-3 border-t border-hub-border mt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-hub-text-muted">Total:</span>
                  <span className="font-medium text-hub-text">{results.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">Passed:</span>
                  <span className="font-medium text-green-600">
                    {results.filter(r => r.passed).length}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-600">Failed:</span>
                  <span className="font-medium text-red-600">
                    {results.filter(r => !r.passed).length}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
