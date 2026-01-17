// Get API base URL dynamically at runtime
// - In production (Docker): Uses relative URLs (same origin)
// - In dev mode (port 3000): Uses localhost:8080
const getApiBase = (): string => {
  if (typeof window === 'undefined') {
    return '';  // SSR/build time - will be re-evaluated in browser
  }
  
  // Dev mode: Next.js runs on port 3000, API on 8080
  if (window.location.port === '3000') {
    return 'http://localhost:8080';
  }
  
  // Production: UI and API on same origin, use relative URLs
  return '';
};

export interface Flow {
  name: string;
  description: string;
  version: string;
  stages: Stage[];
}

export interface Stage {
  name: string;
  steps: Step[];
}

export interface Step {
  type: string;
  name: string;
  action?: string;
  method?: string;
  url?: string;
}

export interface RunRequest {
  flow_name: string;
  env: string;
  tenant: string;
  project?: string;
  variables?: Record<string, unknown>;
}

export interface RunResponse {
  run_id: string;
  status: string;
  flow_name: string;
  started_at: string;
  completed_at?: string;
  result?: RunResult;
}

export interface RunResult {
  status: string;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  duration_ms: number;
  stages: StageResult[];
}

export interface StageResult {
  name: string;
  status: string;
  steps: StepResult[];
}

export interface StepResult {
  name: string;
  status: string;
  duration_ms: number;
  error?: string;
}

export interface Artifact {
  name: string;
  type: string;
  size: number;
  created_at: string;
  url: string;
}

export interface ServiceCatalog {
  namespace: string;
  discovered_at: string;
  services: Service[];
}

export interface Service {
  name: string;
  type: string;
  endpoints: string[];
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
  version: string;
}

class ApiClient {
  private getBaseUrl(): string {
    return getApiBase();
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  async getFlows(): Promise<Flow[]> {
    return this.request<Flow[]>('/flows');
  }

  async getCatalog(): Promise<ServiceCatalog> {
    return this.request<ServiceCatalog>('/catalog');
  }

  async triggerDiscovery(): Promise<ServiceCatalog> {
    return this.request<ServiceCatalog>('/discover', { method: 'POST' });
  }

  async startRun(request: RunRequest): Promise<{ run_id: string; status: string }> {
    return this.request('/run', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getRun(runId: string): Promise<RunResponse> {
    return this.request<RunResponse>(`/runs/${runId}`);
  }

  async getArtifacts(runId: string): Promise<Artifact[]> {
    return this.request<Artifact[]>(`/runs/${runId}/artifacts`);
  }
}

export const api = new ApiClient();
