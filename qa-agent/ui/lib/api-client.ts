/**
 * API Client utilities for proxying to QA Agent backend
 */

// Get backend URL from environment or default
export const QA_AGENT_API_URL = process.env.QA_AGENT_API_URL || 'http://localhost:8080';

/**
 * Standard error response format
 */
export interface ApiError {
  error: string;
  detail?: string;
  status: number;
}

/**
 * Proxy a request to the backend API
 */
export async function proxyToBackend(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${QA_AGENT_API_URL}${endpoint}`;
  
  console.log(`[API Proxy] ${options.method || 'GET'} ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    return response;
  } catch (error) {
    console.error(`[API Proxy] Error:`, error);
    throw error;
  }
}

/**
 * Create a JSON error response
 */
export function errorResponse(message: string, status: number = 500, detail?: string): Response {
  return new Response(
    JSON.stringify({
      error: message,
      detail: detail,
      status: status,
    }),
    {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Redact sensitive fields from request body for logging
 */
export function redactSensitive(body: any): any {
  if (!body || typeof body !== 'object') return body;
  
  const redacted = { ...body };
  const sensitiveFields = ['password', 'passwd', 'secret', 'token', 'api_key', 'apiKey'];
  
  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = '***REDACTED***';
    }
  }
  
  return redacted;
}
