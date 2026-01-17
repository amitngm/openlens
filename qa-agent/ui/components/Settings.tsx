'use client';

import { useState, useEffect } from 'react';
import { Save, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

interface SettingsForm {
  apiUrl: string;
  defaultEnv: string;
  defaultTenant: string;
  allowProd: boolean;
  pollingInterval: number;
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsForm>({
    apiUrl: '',
    defaultEnv: 'dev',
    defaultTenant: '',
    allowProd: false,
    pollingInterval: 2000,
  });
  const [saved, setSaved] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('qa-agent-settings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('qa-agent-settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-hub-text">Settings</h1>
          <p className="text-sm text-hub-text-muted mt-1">Configure QA Agent preferences</p>
        </div>
        <button
          onClick={handleSave}
          className={clsx(
            'btn',
            saved ? 'btn-primary bg-green-600 hover:bg-green-700' : 'btn-primary'
          )}
        >
          {saved ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </div>

      <div className="space-y-6">
        {/* API Configuration */}
        <div className="card">
          <h3 className="text-lg font-semibold text-hub-text mb-4">API Configuration</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-hub-text-muted mb-2">
                API Base URL
              </label>
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                placeholder="Leave empty to use current origin"
                className="input font-mono"
              />
              <p className="text-xs text-hub-text-muted mt-1">
                The base URL of the QA Agent API (leave empty for same-origin)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-hub-text-muted mb-2">
                Polling Interval (ms)
              </label>
              <input
                type="number"
                value={settings.pollingInterval}
                onChange={(e) => setSettings({ ...settings, pollingInterval: parseInt(e.target.value) || 2000 })}
                min={500}
                max={10000}
                step={500}
                className="input"
              />
              <p className="text-xs text-hub-text-muted mt-1">
                How often to check for run status updates
              </p>
            </div>
          </div>
        </div>

        {/* Default Values */}
        <div className="card">
          <h3 className="text-lg font-semibold text-hub-text mb-4">Default Values</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-hub-text-muted mb-2">
                Default Environment
              </label>
              <select
                value={settings.defaultEnv}
                onChange={(e) => setSettings({ ...settings, defaultEnv: e.target.value })}
                className="input"
              >
                <option value="dev">Development</option>
                <option value="staging">Staging</option>
                <option value="prod">Production</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-hub-text-muted mb-2">
                Default Tenant
              </label>
              <input
                type="text"
                value={settings.defaultTenant}
                onChange={(e) => setSettings({ ...settings, defaultTenant: e.target.value })}
                placeholder="e.g., test-tenant-001"
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Safety Settings */}
        <div className="card border-yellow-300">
          <h3 className="text-lg font-semibold text-hub-text mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            Safety Settings
          </h3>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-50 border border-yellow-200">
              <input
                type="checkbox"
                id="allowProd"
                checked={settings.allowProd}
                onChange={(e) => setSettings({ ...settings, allowProd: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-yellow-400 text-yellow-600 focus:ring-yellow-500"
              />
              <label htmlFor="allowProd" className="flex-1">
                <span className="block text-sm font-medium text-yellow-800">
                  Allow Production Environment
                </span>
                <span className="block text-xs text-yellow-700 mt-0.5">
                  Enable running tests against production. Use with extreme caution and only with test accounts.
                </span>
              </label>
            </div>

            <p className="text-xs text-hub-text-muted">
              Note: Even with this enabled, the TEST_ACCOUNT_GUARD still requires explicit testTenant=true flag.
            </p>
          </div>
        </div>

        {/* Documentation Links */}
        <div className="card">
          <h3 className="text-lg font-semibold text-hub-text mb-4">Documentation</h3>
          
          <div className="space-y-2">
            {[
              { label: 'API Documentation', href: '/docs' },
              { label: 'Health Check', href: '/health' },
              { label: 'GitHub Repository', href: 'https://github.com/amitngm/openlens' },
            ].map((link, idx) => (
              <a
                key={idx}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-hub-border
                         hover:border-hub-blue hover:bg-hub-blue-light transition-colors group"
              >
                <span className="text-sm text-hub-text-muted group-hover:text-hub-blue transition-colors">
                  {link.label}
                </span>
                <ExternalLink className="w-4 h-4 text-hub-text-muted group-hover:text-hub-blue transition-colors" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
