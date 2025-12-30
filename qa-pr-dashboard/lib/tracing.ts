/**
 * Frontend Distributed Tracing Utilities
 * Generates and propagates correlation IDs for UI actions
 */

/**
 * Generate a correlation ID (UUID v4)
 */
export function generateCorrelationId(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback: generate UUID v4 manually
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a span ID (8-byte hex string)
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate W3C traceparent header value
 * Format: 00-{trace-id}-{parent-id}-{flags}
 */
export function generateTraceparent(traceId?: string, parentId?: string, flags: string = '01'): string {
  const traceIdValue = traceId || generateCorrelationId();
  const spanId = parentId || generateSpanId();
  return `00-${traceIdValue}-${spanId}-${flags}`;
}

/**
 * Get or create correlation ID from session storage
 * This ensures the same trace ID is used for a user session
 */
export function getOrCreateCorrelationId(): string {
  if (typeof window === 'undefined') {
    return generateCorrelationId();
  }

  const STORAGE_KEY = 'x-trace-id';
  let correlationId = sessionStorage.getItem(STORAGE_KEY);

  if (!correlationId) {
    correlationId = generateCorrelationId();
    sessionStorage.setItem(STORAGE_KEY, correlationId);
  }

  return correlationId;
}

/**
 * Create trace headers for API requests
 */
export function createTraceHeaders(traceId?: string): Record<string, string> {
  const correlationId = traceId || getOrCreateCorrelationId();
  const traceparent = generateTraceparent(correlationId);

  return {
    'X-Request-ID': correlationId,
    'X-Trace-ID': correlationId,
    'Traceparent': traceparent,
  };
}

/**
 * Extract correlation ID from response headers
 */
export function extractCorrelationId(response: Response): string | null {
  return response.headers.get('X-Request-ID') || 
         response.headers.get('X-Trace-ID') || 
         null;
}

/**
 * Log UI action with correlation ID
 */
export function logUIAction(action: string, details?: Record<string, any>): string {
  const correlationId = getOrCreateCorrelationId();
  const logData = {
    action,
    correlationId,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    ...details,
  };

  console.log(`[UI Action] [${correlationId}] ${action}`, logData);
  
  // Optionally send to analytics or logging service
  // sendToAnalytics(logData);

  return correlationId;
}

/**
 * Wrap a fetch call with automatic trace header propagation
 */
export async function tracedFetch(
  url: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const correlationId = getOrCreateCorrelationId();
  const traceHeaders = createTraceHeaders(correlationId);

  const headers = new Headers(init?.headers);
  Object.entries(traceHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const startTime = Date.now();
  console.log(`[${correlationId}] Fetch: ${typeof url === 'string' ? url : url.toString()}`);

  try {
    const response = await fetch(url, {
      ...init,
      headers,
    });

    const duration = Date.now() - startTime;
    const responseCorrelationId = extractCorrelationId(response);
    
    console.log(`[${correlationId}] Fetch completed: ${response.status} - ${duration}ms`, {
      responseCorrelationId,
      url: typeof url === 'string' ? url : url.toString(),
    });

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${correlationId}] Fetch failed: ${error} - ${duration}ms`, {
      url: typeof url === 'string' ? url : url.toString(),
    });
    throw error;
  }
}

/**
 * Create a trace context for a specific UI action
 * Use this when you want to track a specific user action through the system
 */
export function createTraceContext(actionName: string): {
  correlationId: string;
  traceHeaders: Record<string, string>;
  logAction: (details?: Record<string, any>) => void;
} {
  const correlationId = generateCorrelationId();
  const traceHeaders = createTraceHeaders(correlationId);

  // Store in session storage for this action
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(`trace-${actionName}`, correlationId);
  }

  return {
    correlationId,
    traceHeaders,
    logAction: (details?: Record<string, any>) => {
      logUIAction(actionName, { correlationId, ...details });
    },
  };
}
