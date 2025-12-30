/**
 * Distributed Tracing Middleware
 * Implements correlation ID propagation and OpenTelemetry tracing
 */

import { v4 as uuidv4 } from 'uuid';
import { getTracer } from './opentelemetry.js';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

// Trace context storage (using AsyncLocalStorage for async context)
const traceContext = new Map();

/**
 * Generate or extract correlation ID from headers
 * Supports multiple header formats:
 * - x-request-id (standard)
 * - x-trace-id (alternative)
 * - traceparent (W3C Trace Context)
 */
export function getCorrelationId(req) {
  // Try W3C traceparent first (format: 00-{trace-id}-{parent-id}-{flags})
  const traceparent = req.headers['traceparent'];
  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 2) {
      return parts[1]; // Return trace-id from traceparent
    }
  }

  // Try x-request-id
  if (req.headers['x-request-id']) {
    return req.headers['x-request-id'];
  }

  // Try x-trace-id
  if (req.headers['x-trace-id']) {
    return req.headers['x-trace-id'];
  }

  // Generate new correlation ID
  return uuidv4();
}

/**
 * Extract parent span ID from traceparent header
 */
export function getParentSpanId(req) {
  const traceparent = req.headers['traceparent'];
  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 3) {
      return parts[2]; // Return parent-id
    }
  }
  return null;
}

/**
 * Generate W3C traceparent header value
 */
export function generateTraceparent(traceId, parentId = null, flags = '01') {
  const spanId = parentId || generateSpanId();
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Generate a span ID (8-byte hex string)
 */
function generateSpanId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Express middleware for correlation ID propagation and OpenTelemetry tracing
 * Note: OpenTelemetry auto-instrumentations will create spans automatically
 * This middleware adds correlation IDs and enriches spans with request context
 */
export function correlationIdMiddleware(req, res, next) {
  // Get or generate correlation ID
  const correlationId = getCorrelationId(req);
  const parentSpanId = getParentSpanId(req);
  
  // Store in request object for easy access
  req.correlationId = correlationId;
  req.parentSpanId = parentSpanId;
  req.traceId = correlationId;
  
  // Get current active span (created by auto-instrumentations)
  const activeSpan = trace.getActiveSpan(context.active());
  
  // Enrich span with correlation ID if available
  if (activeSpan) {
    activeSpan.setAttribute('http.request_id', correlationId);
    activeSpan.setAttribute('correlation.id', correlationId);
    req.span = activeSpan;
  }
  
  // Store in trace context
  traceContext.set(correlationId, {
    traceId: correlationId,
    parentSpanId,
    startTime: Date.now(),
    path: req.path,
    method: req.method,
    span: activeSpan,
  });

  // Add correlation ID to response headers
  res.setHeader('X-Request-ID', correlationId);
  res.setHeader('X-Trace-ID', correlationId);
  
  // Generate traceparent for downstream services
  const traceparent = generateTraceparent(correlationId, parentSpanId);
  res.setHeader('Traceparent', traceparent);
  
  // Add OpenTelemetry trace ID to response headers if available
  if (activeSpan) {
    const spanContext = activeSpan.spanContext();
    if (spanContext.traceId) {
      res.setHeader('X-OTel-Trace-Id', spanContext.traceId);
      res.setHeader('X-OTel-Span-Id', spanContext.spanId);
    }
  }

  // Log request with correlation ID
  console.log(`[${correlationId}] ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString(),
    traceId: activeSpan?.spanContext()?.traceId,
  });

  // Clean up trace context on response finish
  res.on('finish', () => {
    const context = traceContext.get(correlationId);
    if (context) {
      const duration = Date.now() - context.startTime;
      
      // Enrich span with response details
      if (activeSpan) {
        activeSpan.setAttribute('http.response.duration_ms', duration);
        if (res.statusCode >= 400) {
          activeSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${res.statusCode}`,
          });
        }
      }
      
      console.log(`[${correlationId}] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
      traceContext.delete(correlationId);
    }
  });

  // Handle errors
  res.on('error', (error) => {
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    }
  });

  next();
}

/**
 * Get current trace context
 */
export function getTraceContext(correlationId) {
  return traceContext.get(correlationId) || null;
}

/**
 * Helper to propagate trace headers to downstream services
 * OpenTelemetry auto-instrumentations will handle context propagation automatically
 */
export function propagateTraceHeaders(req, headers = {}) {
  const correlationId = req.correlationId || getCorrelationId(req);
  const traceparent = req.headers['traceparent'] || generateTraceparent(correlationId);

  return {
    ...headers,
    'X-Request-ID': correlationId,
    'X-Trace-ID': correlationId,
    'Traceparent': traceparent,
  };
}

/**
 * Create a child span context for nested operations
 */
export function createChildSpan(req, operationName) {
  const correlationId = req.correlationId || getCorrelationId(req);
  const spanId = generateSpanId();
  const traceparent = generateTraceparent(correlationId, spanId);

  return {
    correlationId,
    spanId,
    traceparent,
    operationName,
    startTime: Date.now(),
  };
}

/**
 * Setup axios interceptor to automatically propagate trace headers
 * Call this once during app initialization
 */
export function setupAxiosTracing(axiosInstance) {
  axiosInstance.interceptors.request.use((config) => {
    // Try to get correlation ID from current request context
    // If not available, generate a new one
    const correlationId = config.headers?.['x-request-id'] || 
                         config.headers?.['x-trace-id'] ||
                         uuidv4();
    
    const traceparent = config.headers?.['traceparent'] || 
                       generateTraceparent(correlationId);

    // Ensure trace headers are set
    config.headers = config.headers || {};
    config.headers['X-Request-ID'] = correlationId;
    config.headers['X-Trace-ID'] = correlationId;
    config.headers['Traceparent'] = traceparent;

    return config;
  });

  axiosInstance.interceptors.response.use(
    (response) => {
      // Log response with correlation ID if available
      const correlationId = response.config?.headers?.['x-request-id'];
      if (correlationId) {
        console.log(`[${correlationId}] External API call: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
      }
      return response;
    },
    (error) => {
      const correlationId = error.config?.headers?.['x-request-id'];
      if (correlationId) {
        console.error(`[${correlationId}] External API call failed: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.message}`);
      }
      return Promise.reject(error);
    }
  );
}
