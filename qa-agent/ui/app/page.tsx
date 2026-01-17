'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import FlowCard from '@/components/FlowCard';
import RunModal from '@/components/RunModal';
import RunStatus from '@/components/RunStatus';
import ServiceCatalog from '@/components/ServiceCatalog';
import RunHistory from '@/components/RunHistory';
import Settings from '@/components/Settings';
import SmartTest from '@/components/SmartTest';
import AutoDiscoveryTest from '@/components/AutoDiscoveryTest';
import LiveTestRunner from '@/components/LiveTestRunner';
import NamespaceSelector from '@/components/NamespaceSelector';
import { api, Flow } from '@/lib/api';

export default function Home() {
  const [activeTab, setActiveTab] = useState('live');
  const [apiStatus, setApiStatus] = useState<'healthy' | 'unhealthy' | 'loading'>('loading');
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['default']);
  
  // Modal states
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Check API health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await api.getHealth();
        setApiStatus('healthy');
      } catch {
        setApiStatus('unhealthy');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load flows
  useEffect(() => {
    const loadFlows = async () => {
      setFlowsLoading(true);
      try {
        const data = await api.getFlows();
        setFlows(data);
        setFlowsError(null);
      } catch (err) {
        setFlowsError(err instanceof Error ? err.message : 'Failed to load flows');
      } finally {
        setFlowsLoading(false);
      }
    };

    if (activeTab === 'flows') {
      loadFlows();
    }
  }, [activeTab]);

  const handleRunFlow = (flow: Flow) => {
    setSelectedFlow(flow);
  };

  const handleRunStarted = (runId: string) => {
    setSelectedFlow(null);
    setActiveRunId(runId);
  };

  const handleSmartTest = (config: unknown) => {
    console.log('Smart test started:', config);
    // Could show a run status modal here
    setActiveRunId(`smart-${Date.now()}`);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'live':
        return <LiveTestRunner />;
      
      case 'autodiscover':
        return <AutoDiscoveryTest />;
      
      case 'smart':
        return <SmartTest onStartTest={handleSmartTest} />;
      
      case 'namespaces':
        return (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-white">Namespace Configuration</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Select which Kubernetes namespaces to monitor and run tests in
              </p>
            </div>
            <div className="max-w-xl">
              <NamespaceSelector
                selectedNamespaces={selectedNamespaces}
                onSelectionChange={setSelectedNamespaces}
              />
            </div>
            {selectedNamespaces.length > 0 && (
              <div className="mt-6 p-4 rounded-lg bg-neon/10 border border-neon/30">
                <p className="text-sm text-neon">
                  ✓ QA Agent will discover and test services in: {selectedNamespaces.join(', ')}
                </p>
              </div>
            )}
          </div>
        );
      
      case 'flows':
        return (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-white">Test Flows</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Select a flow to run automated tests
                </p>
              </div>
              <button
                onClick={() => {
                  setFlowsLoading(true);
                  api.getFlows().then(setFlows).finally(() => setFlowsLoading(false));
                }}
                disabled={flowsLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                         bg-slate/30 text-zinc-400 hover:text-white hover:bg-slate/50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${flowsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {flowsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-electric animate-spin" />
              </div>
            ) : flowsError ? (
              <div className="card border-danger/30 bg-danger/5">
                <div className="flex items-center gap-3 text-danger">
                  <AlertCircle className="w-5 h-5" />
                  <p>{flowsError}</p>
                </div>
                <p className="text-sm text-zinc-500 mt-2">
                  Make sure the QA Agent API is running and flows are configured in the FLOWS_DIR.
                </p>
              </div>
            ) : flows.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {flows.map((flow, idx) => (
                  <FlowCard key={idx} flow={flow} onRun={handleRunFlow} />
                ))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <div className="w-16 h-16 rounded-full bg-slate/30 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-zinc-600" />
                </div>
                <h3 className="text-lg font-medium text-zinc-400">No Flows Found</h3>
                <p className="text-sm text-zinc-600 mt-1 max-w-md mx-auto">
                  Add YAML flow definitions to the flows directory and restart the API.
                </p>
              </div>
            )}
          </div>
        );
      
      case 'runs':
        return <RunHistory onSelectRun={setActiveRunId} />;
      
      case 'catalog':
        return <ServiceCatalog />;
      
      case 'settings':
        return <Settings />;
      
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        apiStatus={apiStatus}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>

      {/* Run Modal */}
      {selectedFlow && (
        <RunModal
          flow={selectedFlow}
          onClose={() => setSelectedFlow(null)}
          onRunStarted={handleRunStarted}
        />
      )}

      {/* Run Status Modal */}
      {activeRunId && (
        <RunStatus
          runId={activeRunId}
          onClose={() => setActiveRunId(null)}
        />
      )}
    </div>
  );
}
