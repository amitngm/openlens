'use client';

import { useState, useEffect } from 'react';
import { 
  Play,
  Pause,
  SkipForward,
  Camera,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Key,
  Eye,
  MousePointer2,
  MessageSquare,
  ChevronRight,
  Monitor,
  Smartphone,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Move,
  Target,
  Plus,
  X,
  Send,
  Sparkles
} from 'lucide-react';
import clsx from 'clsx';

interface TestStep {
  id: string;
  action: string;
  target?: string;
  value?: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  screenshot?: string;
  error?: string;
}

interface ClickableArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  type: 'button' | 'input' | 'link' | 'menu' | 'table' | 'custom';
}

export default function LiveTestRunner() {
  const [phase, setPhase] = useState<'setup' | 'login' | 'explore' | 'guide' | 'testing' | 'complete'>('setup');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Preview state
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loginVerified, setLoginVerified] = useState(false);
  const [viewportSize, setViewportSize] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [zoom, setZoom] = useState(100);
  
  // Discovered elements
  const [clickableAreas, setClickableAreas] = useState<ClickableArea[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [userNotes, setUserNotes] = useState<string>('');
  
  // Test execution
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Simulate connecting to the app
  const connectToApp = async () => {
    if (!url) return;
    
    setIsLoading(true);
    setPhase('login');
    
    // Simulate loading
    await new Promise(r => setTimeout(r, 2000));
    
    // Set a placeholder screenshot (in real implementation, this would be from Playwright)
    setCurrentScreenshot('/api/placeholder/800/600');
    setIsLoading(false);
  };

  // Simulate login
  const performLogin = async () => {
    if (!username || !password) return;
    
    setIsLoading(true);
    
    // Simulate login steps
    setSteps([
      { id: '1', action: 'Navigate to login page', status: 'running' },
      { id: '2', action: 'Enter username', target: '#username', value: username, status: 'pending' },
      { id: '3', action: 'Enter password', target: '#password', value: '****', status: 'pending' },
      { id: '4', action: 'Click login button', target: 'button[type="submit"]', status: 'pending' },
      { id: '5', action: 'Verify dashboard loaded', status: 'pending' },
    ]);

    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000));
      setSteps(prev => prev.map((s, idx) => ({
        ...s,
        status: idx < i ? 'passed' : idx === i ? 'running' : 'pending'
      })));
      setCurrentStepIndex(i);
    }

    // Mark all as passed
    setSteps(prev => prev.map(s => ({ ...s, status: 'passed' })));
    setLoginVerified(true);
    setIsLoading(false);
    
    // Move to explore phase and show "logged in" view
    await new Promise(r => setTimeout(r, 500));
    setPhase('explore');
    
    // Simulate discovered clickable areas on the dashboard
    setClickableAreas([
      { id: 'nav-dashboard', x: 10, y: 80, width: 120, height: 35, label: 'Dashboard', type: 'link' },
      { id: 'nav-users', x: 10, y: 120, width: 120, height: 35, label: 'Users', type: 'link' },
      { id: 'nav-settings', x: 10, y: 160, width: 120, height: 35, label: 'Settings', type: 'link' },
      { id: 'nav-reports', x: 10, y: 200, width: 120, height: 35, label: 'Reports', type: 'link' },
      { id: 'btn-create', x: 600, y: 100, width: 100, height: 36, label: 'Create New', type: 'button' },
      { id: 'btn-export', x: 710, y: 100, width: 80, height: 36, label: 'Export', type: 'button' },
      { id: 'search-input', x: 200, y: 100, width: 300, height: 36, label: 'Search', type: 'input' },
      { id: 'data-table', x: 150, y: 180, width: 640, height: 350, label: 'Data Table', type: 'table' },
      { id: 'user-menu', x: 720, y: 20, width: 70, height: 40, label: 'User Menu', type: 'menu' },
    ]);
  };

  const toggleAreaSelection = (areaId: string) => {
    const newSelected = new Set(selectedAreas);
    if (newSelected.has(areaId)) {
      newSelected.delete(areaId);
    } else {
      newSelected.add(areaId);
    }
    setSelectedAreas(newSelected);
  };

  const selectAllAreas = () => {
    setSelectedAreas(new Set(clickableAreas.map(a => a.id)));
  };

  const startGuidedTesting = () => {
    setPhase('guide');
  };

  const runSelectedTests = async () => {
    setPhase('testing');
    
    // Generate test steps based on selected areas
    const testSteps: TestStep[] = [];
    
    selectedAreas.forEach(areaId => {
      const area = clickableAreas.find(a => a.id === areaId);
      if (area) {
        if (area.type === 'button') {
          testSteps.push({ id: `click-${area.id}`, action: `Click "${area.label}" button`, status: 'pending' });
          testSteps.push({ id: `verify-${area.id}`, action: `Verify action completed`, status: 'pending' });
        } else if (area.type === 'link') {
          testSteps.push({ id: `nav-${area.id}`, action: `Navigate to "${area.label}"`, status: 'pending' });
          testSteps.push({ id: `verify-${area.id}`, action: `Verify page loaded`, status: 'pending' });
        } else if (area.type === 'input') {
          testSteps.push({ id: `fill-${area.id}`, action: `Fill "${area.label}" with test data`, status: 'pending' });
        } else if (area.type === 'table') {
          testSteps.push({ id: `check-${area.id}`, action: `Verify "${area.label}" has data`, status: 'pending' });
          testSteps.push({ id: `sort-${area.id}`, action: `Test sorting in "${area.label}"`, status: 'pending' });
        }
      }
    });

    setSteps(testSteps);

    // Execute tests
    for (let i = 0; i < testSteps.length; i++) {
      if (isPaused) {
        await new Promise(r => {
          const checkPause = setInterval(() => {
            if (!isPaused) {
              clearInterval(checkPause);
              r(undefined);
            }
          }, 100);
        });
      }
      
      setCurrentStepIndex(i);
      setSteps(prev => prev.map((s, idx) => ({
        ...s,
        status: idx < i ? (Math.random() > 0.15 ? 'passed' : 'failed') : idx === i ? 'running' : 'pending'
      })));
      
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
    }

    // Final status
    setSteps(prev => prev.map(s => ({
      ...s,
      status: s.status === 'running' ? (Math.random() > 0.15 ? 'passed' : 'failed') : s.status
    })));
    
    setPhase('complete');
  };

  const getAreaColor = (type: string) => {
    switch (type) {
      case 'button': return 'border-green-500 bg-green-500/20';
      case 'input': return 'border-blue-500 bg-blue-500/20';
      case 'link': return 'border-purple-500 bg-purple-500/20';
      case 'menu': return 'border-orange-500 bg-orange-500/20';
      case 'table': return 'border-cyan-500 bg-cyan-500/20';
      default: return 'border-zinc-500 bg-zinc-500/20';
    }
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
            <Eye className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Live Test Runner</h2>
            <p className="text-xs text-zinc-500">
              {phase === 'setup' && 'Connect to your application'}
              {phase === 'login' && 'Verifying login...'}
              {phase === 'explore' && '✓ Logged in! Select areas to test'}
              {phase === 'guide' && 'Add guidance for testing'}
              {phase === 'testing' && 'Running tests...'}
              {phase === 'complete' && 'Testing complete!'}
            </p>
          </div>
        </div>

        {/* Viewport controls */}
        {currentScreenshot && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-slate/50">
              {(['desktop', 'tablet', 'mobile'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setViewportSize(size)}
                  className={clsx(
                    'px-3 py-1.5 text-xs transition-colors',
                    viewportSize === size 
                      ? 'bg-electric text-midnight' 
                      : 'bg-slate/30 text-zinc-400 hover:text-white'
                  )}
                >
                  {size === 'desktop' && <Monitor className="w-4 h-4" />}
                  {size === 'tablet' && <Monitor className="w-3 h-3" />}
                  {size === 'mobile' && <Smartphone className="w-4 h-4" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button 
                onClick={() => setZoom(z => Math.max(50, z - 10))}
                className="p-1 rounded text-zinc-400 hover:text-white"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-500 w-10 text-center">{zoom}%</span>
              <button 
                onClick={() => setZoom(z => Math.min(150, z + 10))}
                className="p-1 rounded text-zinc-400 hover:text-white"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main content - Split view */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left panel - Controls */}
        <div className="w-80 flex flex-col gap-4 overflow-y-auto">
          {/* Setup Phase */}
          {phase === 'setup' && (
            <>
              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
                  <Globe className="w-4 h-4" />
                  Application URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-app.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-electric"
                />
              </div>

              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
                  <Key className="w-4 h-4" />
                  Login Credentials
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="w-full px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-electric mb-2"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-electric"
                />
              </div>

              <button
                onClick={connectToApp}
                disabled={!url}
                className={clsx(
                  'w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2',
                  'bg-gradient-to-r from-green-500 to-emerald-500 text-white',
                  'hover:shadow-lg hover:shadow-green-500/30 transition-all',
                  !url && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Play className="w-5 h-5" />
                Connect & Login
              </button>
            </>
          )}

          {/* Login Phase */}
          {phase === 'login' && (
            <div className="card">
              <h3 className="text-sm font-medium text-white mb-3">Login Progress</h3>
              <div className="space-y-2">
                {steps.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-2 text-sm">
                    {step.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-neon" />}
                    {step.status === 'running' && <Loader2 className="w-4 h-4 text-electric animate-spin" />}
                    {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-zinc-600" />}
                    <span className={clsx(
                      step.status === 'passed' && 'text-neon',
                      step.status === 'running' && 'text-electric',
                      step.status === 'pending' && 'text-zinc-500'
                    )}>
                      {step.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Explore Phase - Area selection */}
          {phase === 'explore' && (
            <>
              <div className="card border-neon/30 bg-neon/5">
                <div className="flex items-center gap-2 text-neon">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Login Successful!</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Application is ready. Select areas to test.
                </p>
              </div>

              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-white">Detected Elements</h3>
                  <button 
                    onClick={selectAllAreas}
                    className="text-xs text-electric hover:underline"
                  >
                    Select All
                  </button>
                </div>
                
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {clickableAreas.map(area => (
                    <button
                      key={area.id}
                      onClick={() => toggleAreaSelection(area.id)}
                      className={clsx(
                        'w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors',
                        selectedAreas.has(area.id) 
                          ? 'bg-electric/20 text-electric' 
                          : 'hover:bg-slate/30 text-zinc-400'
                      )}
                    >
                      <div className={clsx(
                        'w-3 h-3 rounded-sm border',
                        selectedAreas.has(area.id) ? 'bg-electric border-electric' : 'border-zinc-600'
                      )} />
                      <span>{area.label}</span>
                      <span className="ml-auto text-xs opacity-60">{area.type}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
                  <MessageSquare className="w-4 h-4" />
                  Guidance Notes (Optional)
                </label>
                <textarea
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  placeholder="E.g., 'Focus on the Create button flow' or 'Test search with special characters'"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                           text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-electric resize-none"
                />
              </div>

              <button
                onClick={runSelectedTests}
                disabled={selectedAreas.size === 0}
                className={clsx(
                  'w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2',
                  'bg-gradient-to-r from-electric to-neon text-midnight',
                  'hover:shadow-lg hover:shadow-electric/30 transition-all',
                  selectedAreas.size === 0 && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Sparkles className="w-5 h-5" />
                Test {selectedAreas.size} Areas
              </button>
            </>
          )}

          {/* Testing Phase */}
          {(phase === 'testing' || phase === 'complete') && (
            <>
              {phase === 'testing' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="flex-1 py-2 rounded-lg bg-slate/30 text-zinc-400 hover:text-white flex items-center justify-center gap-2"
                  >
                    {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button className="flex-1 py-2 rounded-lg bg-slate/30 text-zinc-400 hover:text-white flex items-center justify-center gap-2">
                    <SkipForward className="w-4 h-4" />
                    Skip
                  </button>
                </div>
              )}

              <div className="card flex-1 overflow-hidden">
                <h3 className="text-sm font-medium text-white mb-3">
                  {phase === 'complete' ? 'Test Results' : 'Running...'}
                </h3>
                <div className="space-y-1 overflow-y-auto max-h-64">
                  {steps.map((step, idx) => (
                    <div 
                      key={step.id} 
                      className={clsx(
                        'flex items-center gap-2 p-2 rounded text-sm',
                        idx === currentStepIndex && phase === 'testing' && 'bg-electric/10'
                      )}
                    >
                      {step.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-neon flex-shrink-0" />}
                      {step.status === 'failed' && <XCircle className="w-4 h-4 text-danger flex-shrink-0" />}
                      {step.status === 'running' && <Loader2 className="w-4 h-4 text-electric animate-spin flex-shrink-0" />}
                      {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-zinc-600 flex-shrink-0" />}
                      <span className={clsx(
                        'truncate',
                        step.status === 'passed' && 'text-neon',
                        step.status === 'failed' && 'text-danger',
                        step.status === 'running' && 'text-electric',
                        step.status === 'pending' && 'text-zinc-500'
                      )}>
                        {step.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {phase === 'complete' && (
                <div className="card bg-gradient-to-r from-neon/10 to-electric/10 border-neon/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">Testing Complete!</p>
                      <p className="text-xs text-zinc-400">
                        {steps.filter(s => s.status === 'passed').length}/{steps.length} passed
                      </p>
                    </div>
                    <div className="text-2xl font-bold text-neon">
                      {Math.round((steps.filter(s => s.status === 'passed').length / steps.length) * 100)}%
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right panel - Preview */}
        <div className="flex-1 card p-2 flex flex-col min-h-0">
          <div className="flex-1 relative bg-slate/50 rounded-lg overflow-hidden">
            {!currentScreenshot && phase === 'setup' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <Monitor className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-500">Enter URL to connect</p>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-midnight/80 z-10">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-electric animate-spin mx-auto mb-2" />
                  <p className="text-zinc-400 text-sm">Loading...</p>
                </div>
              </div>
            )}

            {/* Mock Application Preview */}
            {(phase !== 'setup' || currentScreenshot) && (
              <div 
                className="absolute inset-0 bg-white overflow-hidden"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
              >
                {/* Mock app header */}
                <div className="bg-slate-800 h-12 flex items-center px-4 justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-electric/20 flex items-center justify-center">
                      <span className="text-electric font-bold text-sm">A</span>
                    </div>
                    <span className="text-white font-medium">Your App</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-700" />
                  </div>
                </div>

                {/* Mock app content */}
                <div className="flex h-[calc(100%-48px)]">
                  {/* Sidebar */}
                  <div className="w-40 bg-slate-100 p-3 space-y-1">
                    {['Dashboard', 'Users', 'Settings', 'Reports'].map((item, idx) => (
                      <div key={item} className={clsx(
                        'px-3 py-2 rounded text-sm',
                        idx === 0 ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-200'
                      )}>
                        {item}
                      </div>
                    ))}
                  </div>

                  {/* Main content */}
                  <div className="flex-1 p-4 bg-slate-50">
                    <div className="flex items-center justify-between mb-4">
                      <input 
                        className="px-3 py-2 rounded border border-slate-300 w-64 text-sm"
                        placeholder="Search..."
                      />
                      <div className="flex gap-2">
                        <button className="px-4 py-2 bg-blue-500 text-white rounded text-sm">
                          Create New
                        </button>
                        <button className="px-4 py-2 bg-slate-200 text-slate-700 rounded text-sm">
                          Export
                        </button>
                      </div>
                    </div>

                    {/* Mock table */}
                    <div className="bg-white rounded border border-slate-200">
                      <div className="grid grid-cols-4 gap-4 p-3 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <div>Name</div>
                        <div>Status</div>
                        <div>Date</div>
                        <div>Actions</div>
                      </div>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="grid grid-cols-4 gap-4 p-3 border-b border-slate-100 text-sm">
                          <div className="text-slate-700">Item {i}</div>
                          <div><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Active</span></div>
                          <div className="text-slate-500">Jan {10 + i}, 2026</div>
                          <div className="text-blue-500 text-xs">Edit | Delete</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Overlay clickable areas when exploring */}
                {phase === 'explore' && (
                  <div className="absolute inset-0 pointer-events-none">
                    {clickableAreas.map(area => (
                      <button
                        key={area.id}
                        onClick={() => toggleAreaSelection(area.id)}
                        className={clsx(
                          'absolute border-2 rounded transition-all pointer-events-auto',
                          getAreaColor(area.type),
                          selectedAreas.has(area.id) && 'ring-2 ring-white ring-offset-1'
                        )}
                        style={{
                          left: area.x,
                          top: area.y + 48, // Account for header
                          width: area.width,
                          height: area.height,
                        }}
                      >
                        <span className="absolute -top-5 left-0 text-xs bg-black/70 text-white px-1 rounded whitespace-nowrap">
                          {area.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Login overlay */}
            {phase === 'login' && loginVerified && (
              <div className="absolute inset-0 flex items-center justify-center bg-neon/10 z-20">
                <div className="text-center">
                  <CheckCircle2 className="w-16 h-16 text-neon mx-auto mb-2 animate-bounce" />
                  <p className="text-neon font-medium text-lg">Login Verified!</p>
                </div>
              </div>
            )}
          </div>

          {/* Preview footer */}
          <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
            <span>
              {viewportSize === 'desktop' && '1920×1080'}
              {viewportSize === 'tablet' && '768×1024'}
              {viewportSize === 'mobile' && '375×667'}
            </span>
            <div className="flex items-center gap-2">
              <Camera className="w-3 h-3" />
              <span>Live Preview</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
