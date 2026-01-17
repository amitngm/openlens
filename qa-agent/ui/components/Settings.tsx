'use client';

import { useState } from 'react';
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
    apiUrl: 'http://localhost:8080',
    defaultEnv: 'dev',
    defaultTenant: '',
    allowProd: false,
    pollingInterval: 2000,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In a real app, save to localStorage or backend
    localStorage.setItem('qa-agent-settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Settings</h2>
          <p className="text-sm text-zinc-500 mt-1">Configure QA Agent preferences</p>
        </div>
        <button
          onClick={handleSave}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
            saved
              ? 'bg-neon/20 text-neon border border-neon/30'
              : 'bg-electric/10 text-electric border border-electric/30 hover:bg-electric/20'
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
          <h3 className="text-lg font-semibold text-white mb-4">API Configuration</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                API Base URL
              </label>
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors font-mono"
              />
              <p className="text-xs text-zinc-600 mt-1">
                The base URL of the QA Agent API
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Polling Interval (ms)
              </label>
              <input
                type="number"
                value={settings.pollingInterval}
                onChange={(e) => setSettings({ ...settings, pollingInterval: parseInt(e.target.value) || 2000 })}
                min={500}
                max={10000}
                step={500}
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors"
              />
              <p className="text-xs text-zinc-600 mt-1">
                How often to check for run status updates
              </p>
            </div>
          </div>
        </div>

        {/* Default Values */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Default Values</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Default Environment
              </label>
              <select
                value={settings.defaultEnv}
                onChange={(e) => setSettings({ ...settings, defaultEnv: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white focus:outline-none focus:border-electric transition-colors"
              >
                <option value="dev">Development</option>
                <option value="staging">Staging</option>
                <option value="prod">Production</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Default Tenant
              </label>
              <input
                type="text"
                value={settings.defaultTenant}
                onChange={(e) => setSettings({ ...settings, defaultTenant: e.target.value })}
                placeholder="e.g., test-tenant-001"
                className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                         transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Safety Settings */}
        <div className="card border-warning/30">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Safety Settings
          </h3>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <input
                type="checkbox"
                id="allowProd"
                checked={settings.allowProd}
                onChange={(e) => setSettings({ ...settings, allowProd: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-warning/50 text-warning focus:ring-warning"
              />
              <label htmlFor="allowProd" className="flex-1">
                <span className="block text-sm font-medium text-warning">
                  Allow Production Environment
                </span>
                <span className="block text-xs text-zinc-400 mt-0.5">
                  Enable running tests against production. Use with extreme caution and only with test accounts.
                </span>
              </label>
            </div>

            <p className="text-xs text-zinc-500">
              Note: Even with this enabled, the TEST_ACCOUNT_GUARD still requires explicit testTenant=true flag.
            </p>
          </div>
        </div>

        {/* Documentation Links */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Documentation</h3>
          
          <div className="space-y-2">
            {[
              { label: 'Architecture Guide', href: '#' },
              { label: 'Security Best Practices', href: '#' },
              { label: 'Flow Definition Reference', href: '#' },
              { label: 'API Documentation', href: '/api/docs' },
            ].map((link, idx) => (
              <a
                key={idx}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg bg-slate/30 border border-slate/50
                         hover:border-electric/50 transition-colors group"
              >
                <span className="text-sm text-zinc-400 group-hover:text-white transition-colors">
                  {link.label}
                </span>
                <ExternalLink className="w-4 h-4 text-zinc-600 group-hover:text-electric transition-colors" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
