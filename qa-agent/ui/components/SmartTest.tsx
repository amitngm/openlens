'use client';

import { useState } from 'react';
import { 
  Play, 
  Plus, 
  X, 
  Wand2, 
  Globe, 
  Key, 
  Tag,
  Loader2,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';

interface SmartTestConfig {
  url: string;
  username: string;
  password: string;
  keywords: string[];
  actions: string[];
  customSelectors: Record<string, string>;
}

const SUGGESTED_ACTIONS = [
  { id: 'login', label: 'Login', description: 'Authenticate with credentials' },
  { id: 'navigate', label: 'Navigate', description: 'Explore main sections' },
  { id: 'create', label: 'Create', description: 'Create new items/resources' },
  { id: 'search', label: 'Search', description: 'Test search functionality' },
  { id: 'edit', label: 'Edit', description: 'Modify existing items' },
  { id: 'delete', label: 'Delete', description: 'Remove test items' },
  { id: 'export', label: 'Export', description: 'Test export/download' },
  { id: 'filter', label: 'Filter', description: 'Test filtering/sorting' },
];

const COMMON_KEYWORDS = [
  'dashboard', 'settings', 'profile', 'users', 'admin',
  'create', 'new', 'add', 'edit', 'delete', 'save',
  'submit', 'cancel', 'confirm', 'close', 'menu',
  'table', 'list', 'grid', 'card', 'modal', 'form'
];

interface SmartTestProps {
  onStartTest: (config: SmartTestConfig) => void;
}

export default function SmartTest({ onStartTest }: SmartTestProps) {
  const [config, setConfig] = useState<SmartTestConfig>({
    url: '',
    username: '',
    password: '',
    keywords: [],
    actions: ['login', 'navigate'],
    customSelectors: {},
  });
  
  const [newKeyword, setNewKeyword] = useState('');
  const [newSelectorKey, setNewSelectorKey] = useState('');
  const [newSelectorValue, setNewSelectorValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const addKeyword = () => {
    if (newKeyword.trim() && !config.keywords.includes(newKeyword.trim())) {
      setConfig({
        ...config,
        keywords: [...config.keywords, newKeyword.trim()]
      });
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setConfig({
      ...config,
      keywords: config.keywords.filter(k => k !== keyword)
    });
  };

  const toggleAction = (actionId: string) => {
    if (config.actions.includes(actionId)) {
      setConfig({
        ...config,
        actions: config.actions.filter(a => a !== actionId)
      });
    } else {
      setConfig({
        ...config,
        actions: [...config.actions, actionId]
      });
    }
  };

  const addCustomSelector = () => {
    if (newSelectorKey.trim() && newSelectorValue.trim()) {
      setConfig({
        ...config,
        customSelectors: {
          ...config.customSelectors,
          [newSelectorKey.trim()]: newSelectorValue.trim()
        }
      });
      setNewSelectorKey('');
      setNewSelectorValue('');
    }
  };

  const removeCustomSelector = (key: string) => {
    const { [key]: _, ...rest } = config.customSelectors;
    setConfig({ ...config, customSelectors: rest });
  };

  const handleStartTest = async () => {
    if (!config.url) return;
    
    setTesting(true);
    setTestResult(null);
    
    try {
      // Call the smart test API
      const response = await fetch('http://localhost:8080/smart-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      
      if (response.ok) {
        setTestResult('success');
        onStartTest(config);
      } else {
        setTestResult('error');
      }
    } catch (err) {
      setTestResult('error');
      // Still call onStartTest for demo purposes
      onStartTest(config);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
          <Wand2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-white">Smart Test</h2>
          <p className="text-sm text-zinc-500">
            AI-powered testing - just provide URL and credentials
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column - Basic Config */}
        <div className="space-y-6">
          {/* URL */}
          <div className="card">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
              <Globe className="w-4 h-4" />
              Target URL
            </label>
            <input
              type="url"
              value={config.url}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
              placeholder="https://your-app.example.com"
              className="w-full px-4 py-3 rounded-lg bg-slate/30 border border-slate/50
                       text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                       transition-colors font-mono text-sm"
            />
          </div>

          {/* Credentials */}
          <div className="card">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
              <Key className="w-4 h-4" />
              Credentials
            </label>
            <div className="space-y-3">
              <input
                type="text"
                value={config.username}
                onChange={(e) => setConfig({ ...config, username: e.target.value })}
                placeholder="Username or email"
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors"
              />
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
                placeholder="Password"
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="card">
            <label className="text-sm font-medium text-zinc-400 mb-3 block">
              What to Test
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SUGGESTED_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  onClick={() => toggleAction(action.id)}
                  className={clsx(
                    'p-3 rounded-lg border text-left transition-all',
                    config.actions.includes(action.id)
                      ? 'bg-electric/10 border-electric/50 text-electric'
                      : 'bg-slate/20 border-slate/50 text-zinc-400 hover:border-zinc-500'
                  )}
                >
                  <span className="block text-sm font-medium">{action.label}</span>
                  <span className="block text-xs opacity-60">{action.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Advanced Config */}
        <div className="space-y-6">
          {/* Keywords */}
          <div className="card">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
              <Tag className="w-4 h-4" />
              Keywords to Match
            </label>
            <p className="text-xs text-zinc-600 mb-3">
              Add keywords that appear in your UI (button text, labels, menu items)
            </p>
            
            {/* Quick add common keywords */}
            <div className="flex flex-wrap gap-1 mb-3">
              {COMMON_KEYWORDS.filter(k => !config.keywords.includes(k)).slice(0, 8).map((keyword) => (
                <button
                  key={keyword}
                  onClick={() => setConfig({ ...config, keywords: [...config.keywords, keyword] })}
                  className="px-2 py-1 text-xs rounded bg-slate/30 text-zinc-500 
                           hover:bg-slate/50 hover:text-zinc-300 transition-colors"
                >
                  + {keyword}
                </button>
              ))}
            </div>

            {/* Selected keywords */}
            <div className="flex flex-wrap gap-2 mb-3">
              {config.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full
                           bg-purple-500/20 text-purple-400 border border-purple-500/30 text-sm"
                >
                  {keyword}
                  <button onClick={() => removeKeyword(keyword)} className="hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Add custom keyword */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                placeholder="Add custom keyword..."
                className="flex-1 px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors text-sm"
              />
              <button
                onClick={addKeyword}
                className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-400 
                         border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Custom Selectors */}
          <div className="card">
            <label className="text-sm font-medium text-zinc-400 mb-3 block">
              Custom Element Selectors (Optional)
            </label>
            <p className="text-xs text-zinc-600 mb-3">
              Map element names to CSS selectors for precise targeting
            </p>

            {/* Existing selectors */}
            {Object.entries(config.customSelectors).length > 0 && (
              <div className="space-y-2 mb-3">
                {Object.entries(config.customSelectors).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 p-2 rounded bg-slate/30">
                    <span className="text-sm text-neon font-medium">{key}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-sm text-zinc-400 font-mono flex-1 truncate">{value}</span>
                    <button
                      onClick={() => removeCustomSelector(key)}
                      className="text-zinc-500 hover:text-danger"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add selector */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSelectorKey}
                onChange={(e) => setNewSelectorKey(e.target.value)}
                placeholder="Name (e.g., loginBtn)"
                className="w-1/3 px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors text-sm"
              />
              <input
                type="text"
                value={newSelectorValue}
                onChange={(e) => setNewSelectorValue(e.target.value)}
                placeholder="Selector (e.g., #login-btn)"
                className="flex-1 px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors text-sm font-mono"
              />
              <button
                onClick={addCustomSelector}
                className="px-3 py-2 rounded-lg bg-neon/20 text-neon 
                         border border-neon/30 hover:bg-neon/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Start Test Button */}
      <div className="flex items-center justify-between pt-4 border-t border-slate/30">
        <div className="flex items-center gap-2">
          {testResult === 'success' && (
            <span className="flex items-center gap-2 text-neon text-sm">
              <CheckCircle className="w-4 h-4" />
              Test started successfully
            </span>
          )}
          {testResult === 'error' && (
            <span className="flex items-center gap-2 text-warning text-sm">
              <AlertCircle className="w-4 h-4" />
              Running in demo mode (API not configured)
            </span>
          )}
        </div>
        
        <button
          onClick={handleStartTest}
          disabled={!config.url || testing}
          className={clsx(
            'flex items-center gap-2 px-6 py-3 rounded-lg font-semibold',
            'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
            'hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-200',
            (!config.url || testing) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {testing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Wand2 className="w-5 h-5" />
              Start Smart Test
            </>
          )}
        </button>
      </div>
    </div>
  );
}
