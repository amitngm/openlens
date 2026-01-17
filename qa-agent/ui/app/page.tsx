'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw, Plus, Search, Filter } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  
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
              <h1 className="text-2xl font-semibold text-hub-text">Namespace Configuration</h1>
              <p className="text-sm text-hub-text-muted mt-1">
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
              <div className="mt-6 p-4 rounded-lg bg-green-50 border border-green-200">
                <p className="text-sm text-green-700">
                  ✓ QA Agent will discover and test services in: {selectedNamespaces.join(', ')}
                </p>
              </div>
            )}
          </div>
        );
      
      case 'flows':
        return (
          <div>
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-hub-text">Test Flows</h1>
                <p className="text-sm text-hub-text-muted mt-1">
                  All test flows within the QA Agent namespace.
                </p>
              </div>
              <button className="btn btn-primary">
                <Plus className="w-4 h-4" />
                Create a flow
              </button>
            </div>

            {/* Search and Filter Bar */}
            <div className="flex items-center gap-3 mb-6">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hub-text-muted" />
                <input
                  type="text"
                  placeholder="Search by flow name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input input-with-icon"
                />
              </div>
              <select className="input w-40">
                <option>All content</option>
                <option>UI Tests</option>
                <option>API Tests</option>
                <option>E2E Tests</option>
              </select>
            </div>

            {/* Flows Table */}
            {flowsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-hub-blue animate-spin" />
              </div>
            ) : flowsError ? (
              <div className="card border-red-200 bg-red-50">
                <div className="flex items-center gap-3 text-red-700">
                  <AlertCircle className="w-5 h-5" />
                  <p>{flowsError}</p>
                </div>
                <p className="text-sm text-red-600 mt-2">
                  Make sure the QA Agent API is running and flows are configured in the FLOWS_DIR.
                </p>
              </div>
            ) : flows.length > 0 ? (
              <div className="card p-0 overflow-hidden">
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Last Pushed</th>
                        <th>Contains</th>
                        <th>Visibility</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {flows.filter(flow => 
                        flow.name.toLowerCase().includes(searchQuery.toLowerCase())
                      ).map((flow, idx) => (
                        <tr key={idx}>
                          <td>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-hub-blue-light rounded flex items-center justify-center">
                                <span className="text-hub-blue text-xs font-semibold">
                                  {flow.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <div className="font-medium text-hub-text">{flow.name}</div>
                                <div className="text-xs text-hub-text-muted">{flow.description || 'No description'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-hub-text-muted">
                            {new Date().toLocaleDateString()}
                          </td>
                          <td>
                            <span className="badge badge-info">
                              {flow.stages?.length || 0} stages
                            </span>
                          </td>
                          <td>
                            <span className="text-hub-text-muted">Public</span>
                          </td>
                          <td>
                            <span className="badge badge-success">Active</span>
                          </td>
                          <td>
                            <button
                              onClick={() => handleRunFlow(flow)}
                              className="btn btn-primary text-xs py-1 px-3"
                            >
                              Run
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="card text-center py-12">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-hub-text">No Flows Found</h3>
                <p className="text-sm text-hub-text-muted mt-1 max-w-md mx-auto">
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
    <div className="min-h-screen bg-white">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        apiStatus={apiStatus}
      />

      {/* Main Content - offset for fixed sidebar and header */}
      <main className="ml-60 pt-14">
        <div className="p-8 max-w-7xl">
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
