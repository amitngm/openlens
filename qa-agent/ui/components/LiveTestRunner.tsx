'use client';

import { useState } from 'react';
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
  MessageSquare,
  Monitor,
  Smartphone,
  ZoomIn,
  ZoomOut,
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
    
    await new Promise(r => setTimeout(r, 2000));
    
    setCurrentScreenshot('/api/placeholder/800/600');
    setIsLoading(false);
  };

  // Simulate login
  const performLogin = async () => {
    if (!username || !password) return;
    
    setIsLoading(true);
    
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

    setSteps(prev => prev.map(s => ({ ...s, status: 'passed' })));
    setLoginVerified(true);
    setIsLoading(false);
    
    await new Promise(r => setTimeout(r, 500));
    setPhase('explore');
    
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

  const runSelectedTests = async () => {
    setPhase('testing');
    
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
      default: return 'border-gray-500 bg-gray-500/20';
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-hub-text">Live Test Runner</h1>
          <p className="text-sm text-hub-text-muted">
            {phase === 'setup' && 'Connect to your application'}
            {phase === 'login' && 'Verifying login...'}
            {phase === 'explore' && '✓ Logged in! Select areas to test'}
            {phase === 'guide' && 'Add guidance for testing'}
            {phase === 'testing' && 'Running tests...'}
            {phase === 'complete' && 'Testing complete!'}
          </p>
        </div>

        {/* Viewport controls */}
        {currentScreenshot && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-hub-border">
              {(['desktop', 'tablet', 'mobile'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setViewportSize(size)}
                  className={clsx(
                    'px-3 py-1.5 text-xs transition-colors',
                    viewportSize === size 
                      ? 'bg-hub-blue text-white' 
                      : 'bg-white text-hub-text-muted hover:text-hub-text'
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
                className="p-1 rounded text-hub-text-muted hover:text-hub-text"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-hub-text-muted w-10 text-center">{zoom}%</span>
              <button 
                onClick={() => setZoom(z => Math.min(150, z + 10))}
                className="p-1 rounded text-hub-text-muted hover:text-hub-text"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main content - Split view */}
      <div className="flex gap-4" style={{ minHeight: '500px' }}>
        {/* Left panel - Controls */}
        <div className="w-80 flex flex-col gap-4 overflow-y-auto">
          {/* Setup Phase */}
          {phase === 'setup' && (
            <>
              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
                  <Globe className="w-4 h-4 text-hub-blue" />
                  Application URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-app.com"
                  className="input"
                />
              </div>

              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
                  <Key className="w-4 h-4 text-hub-blue" />
                  Login Credentials
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="input mb-2"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="input"
                />
              </div>

              <button
                onClick={connectToApp}
                disabled={!url}
                className={clsx(
                  'btn btn-primary w-full py-3',
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
              <h3 className="text-sm font-medium text-hub-text mb-3">Login Progress</h3>
              <div className="space-y-2">
                {steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-2 text-sm">
                    {step.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {step.status === 'running' && <Loader2 className="w-4 h-4 text-hub-blue animate-spin" />}
                    {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-gray-300" />}
                    <span className={clsx(
                      step.status === 'passed' && 'text-green-600',
                      step.status === 'running' && 'text-hub-blue',
                      step.status === 'pending' && 'text-hub-text-muted'
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
              <div className="card bg-green-50 border-green-200">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Login Successful!</span>
                </div>
                <p className="text-xs text-green-600 mt-1">
                  Application is ready. Select areas to test.
                </p>
              </div>

              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-hub-text">Detected Elements</h3>
                  <button 
                    onClick={selectAllAreas}
                    className="text-xs text-hub-blue hover:underline"
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
                          ? 'bg-hub-blue-light text-hub-blue' 
                          : 'hover:bg-gray-50 text-hub-text-muted'
                      )}
                    >
                      <div className={clsx(
                        'w-3 h-3 rounded-sm border',
                        selectedAreas.has(area.id) ? 'bg-hub-blue border-hub-blue' : 'border-gray-400'
                      )} />
                      <span>{area.label}</span>
                      <span className="ml-auto text-xs opacity-60">{area.type}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
                  <MessageSquare className="w-4 h-4 text-hub-blue" />
                  Guidance Notes (Optional)
                </label>
                <textarea
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  placeholder="E.g., 'Focus on the Create button flow' or 'Test search with special characters'"
                  rows={3}
                  className="input resize-none"
                />
              </div>

              <button
                onClick={runSelectedTests}
                disabled={selectedAreas.size === 0}
                className={clsx(
                  'btn btn-primary w-full py-3',
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
                    className="btn btn-secondary flex-1"
                  >
                    {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button className="btn btn-secondary flex-1">
                    <SkipForward className="w-4 h-4" />
                    Skip
                  </button>
                </div>
              )}

              <div className="card flex-1 overflow-hidden">
                <h3 className="text-sm font-medium text-hub-text mb-3">
                  {phase === 'complete' ? 'Test Results' : 'Running...'}
                </h3>
                <div className="space-y-1 overflow-y-auto max-h-64">
                  {steps.map((step, idx) => (
                    <div 
                      key={step.id} 
                      className={clsx(
                        'flex items-center gap-2 p-2 rounded text-sm',
                        idx === currentStepIndex && phase === 'testing' && 'bg-hub-blue-light'
                      )}
                    >
                      {step.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                      {step.status === 'failed' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                      {step.status === 'running' && <Loader2 className="w-4 h-4 text-hub-blue animate-spin flex-shrink-0" />}
                      {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" />}
                      <span className={clsx(
                        'truncate',
                        step.status === 'passed' && 'text-green-600',
                        step.status === 'failed' && 'text-red-600',
                        step.status === 'running' && 'text-hub-blue',
                        step.status === 'pending' && 'text-hub-text-muted'
                      )}>
                        {step.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {phase === 'complete' && (
                <div className="card bg-green-50 border-green-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-hub-text font-medium">Testing Complete!</p>
                      <p className="text-xs text-hub-text-muted">
                        {steps.filter(s => s.status === 'passed').length}/{steps.length} passed
                      </p>
                    </div>
                    <div className="text-2xl font-bold text-green-600">
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
          <div className="flex-1 relative bg-gray-100 rounded-lg overflow-hidden">
            {!currentScreenshot && phase === 'setup' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <Monitor className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-hub-text-muted">Enter URL to connect</p>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-hub-blue animate-spin mx-auto mb-2" />
                  <p className="text-hub-text-muted text-sm">Loading...</p>
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
                <div className="bg-hub-nav h-12 flex items-center px-4 justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-hub-blue flex items-center justify-center">
                      <span className="text-white font-bold text-sm">A</span>
                    </div>
                    <span className="text-white font-medium">Your App</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-600" />
                  </div>
                </div>

                {/* Mock app content */}
                <div className="flex h-[calc(100%-48px)]">
                  {/* Sidebar */}
                  <div className="w-40 bg-gray-50 border-r border-hub-border p-3 space-y-1">
                    {['Dashboard', 'Users', 'Settings', 'Reports'].map((item, idx) => (
                      <div key={item} className={clsx(
                        'px-3 py-2 rounded text-sm',
                        idx === 0 ? 'bg-hub-blue text-white' : 'text-hub-text-muted hover:bg-gray-100'
                      )}>
                        {item}
                      </div>
                    ))}
                  </div>

                  {/* Main content */}
                  <div className="flex-1 p-4 bg-white">
                    <div className="flex items-center justify-between mb-4">
                      <input 
                        className="input w-64"
                        placeholder="Search..."
                      />
                      <div className="flex gap-2">
                        <button className="btn btn-primary text-sm">
                          Create New
                        </button>
                        <button className="btn btn-secondary text-sm">
                          Export
                        </button>
                      </div>
                    </div>

                    {/* Mock table */}
                    <div className="bg-white rounded-lg border border-hub-border">
                      <div className="grid grid-cols-4 gap-4 p-3 border-b border-hub-border bg-gray-50 text-xs font-semibold text-hub-text-muted uppercase">
                        <div>Name</div>
                        <div>Status</div>
                        <div>Date</div>
                        <div>Actions</div>
                      </div>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="grid grid-cols-4 gap-4 p-3 border-b border-hub-border text-sm">
                          <div className="text-hub-text">Item {i}</div>
                          <div><span className="badge badge-success">Active</span></div>
                          <div className="text-hub-text-muted">Jan {10 + i}, 2026</div>
                          <div className="text-hub-blue text-xs">Edit | Delete</div>
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
                          selectedAreas.has(area.id) && 'ring-2 ring-hub-blue ring-offset-1'
                        )}
                        style={{
                          left: area.x,
                          top: area.y + 48,
                          width: area.width,
                          height: area.height,
                        }}
                      >
                        <span className="absolute -top-5 left-0 text-xs bg-hub-nav text-white px-1 rounded whitespace-nowrap">
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
              <div className="absolute inset-0 flex items-center justify-center bg-green-50/80 z-20">
                <div className="text-center">
                  <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-2 animate-bounce" />
                  <p className="text-green-700 font-medium text-lg">Login Verified!</p>
                </div>
              </div>
            )}
          </div>

          {/* Preview footer */}
          <div className="flex items-center justify-between mt-2 text-xs text-hub-text-muted">
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
