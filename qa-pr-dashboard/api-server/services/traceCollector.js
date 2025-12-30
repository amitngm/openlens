/**
 * Trace Collector Service
 * Fetches traces from OpenTelemetry backends (Jaeger/Tempo) and sends them to Flow Analyzer
 */

import axios from 'axios';

let flowAnalyzer = null;
let collectorInterval = null;
let isCollecting = false;

// Configuration
const COLLECTOR_ENABLED = process.env.TRACE_COLLECTOR_ENABLED !== 'false';
const COLLECTOR_INTERVAL = parseInt(process.env.TRACE_COLLECTOR_INTERVAL || '30000'); // 30 seconds
const JAEGER_API_URL = process.env.JAEGER_API_URL || 'http://localhost:16686';
const TEMPO_API_URL = process.env.TEMPO_API_URL || 'http://localhost:3200';
const TRACING_BACKEND = process.env.TRACING_BACKEND || 'jaeger'; // jaeger or tempo
// Namespace filter - only collect traces from these namespaces
const ALLOWED_NAMESPACES = (process.env.TRACING_NAMESPACES || 'ccs,dbaas').split(',').map(ns => ns.trim());

/**
 * Initialize trace collector
 */
export async function initializeTraceCollector() {
  if (!COLLECTOR_ENABLED) {
    console.log('📊 Trace collector is disabled (set TRACE_COLLECTOR_ENABLED=true to enable)');
    return;
  }

  try {
    // Lazy load flow analyzer
    try {
      const flowAnalyzerModule = await import('./flowAnalyzer.js');
      flowAnalyzer = flowAnalyzerModule;
      console.log('✅ Flow Analyzer loaded for trace collection');
    } catch (error) {
      console.log('⚠️  Flow Analyzer not available, trace collection disabled:', error.message);
      return;
    }

    // Start collecting traces
    startTraceCollection();
    console.log(`✅ Trace collector initialized (${TRACING_BACKEND}, interval: ${COLLECTOR_INTERVAL}ms, namespaces: ${ALLOWED_NAMESPACES.join(', ') || 'all'})`);
  } catch (error) {
    console.error('❌ Failed to initialize trace collector:', error.message);
  }
}

/**
 * Start periodic trace collection
 */
function startTraceCollection() {
  if (collectorInterval) {
    clearInterval(collectorInterval);
  }

  // Collect immediately on start
  collectTraces();

  // Then collect periodically
  collectorInterval = setInterval(() => {
    collectTraces();
  }, COLLECTOR_INTERVAL);
}

/**
 * Stop trace collection
 */
export function stopTraceCollection() {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
  }
  isCollecting = false;
  console.log('📊 Trace collection stopped');
}

/**
 * Collect traces from backend and analyze them
 * @param {string} targetNamespace - Optional namespace to filter traces (if not provided, uses ALLOWED_NAMESPACES)
 */
async function collectTraces(targetNamespace = null) {
  if (isCollecting || !flowAnalyzer) {
    return;
  }

  isCollecting = true;

  try {
    // Use provided namespace or fall back to allowed namespaces
    const namespacesToCollect = targetNamespace ? [targetNamespace] : (ALLOWED_NAMESPACES.length > 0 ? ALLOWED_NAMESPACES : []);
    
    if (TRACING_BACKEND === 'jaeger') {
      await collectFromJaeger(namespacesToCollect);
    } else if (TRACING_BACKEND === 'tempo') {
      await collectFromTempo(namespacesToCollect);
    } else {
      console.warn(`⚠️  Unknown tracing backend: ${TRACING_BACKEND}`);
    }
  } catch (error) {
    console.error('❌ Error collecting traces:', error.message);
  } finally {
    isCollecting = false;
  }
}

/**
 * Collect traces from Jaeger
 */
async function collectFromJaeger() {
  try {
    // Get recent traces (last 5 minutes)
    const endTime = Date.now() * 1000; // Jaeger uses microseconds
    const startTime = endTime - (5 * 60 * 1000 * 1000); // 5 minutes ago

    // Query Jaeger API for traces
    const response = await axios.get(`${JAEGER_API_URL}/api/traces`, {
      params: {
        service: process.env.TRACING_SERVICE_NAME || 'qa-pr-dashboard-api',
        start: startTime,
        end: endTime,
        limit: 100,
      },
      timeout: 5000,
    });

    if (response.data && response.data.data) {
      const traces = response.data.data;
      console.log(`📊 Found ${traces.length} traces in Jaeger`);

      for (const trace of traces) {
        await analyzeJaegerTrace(trace);
      }
    }
  } catch (error) {
    // Silently fail if Jaeger is not available
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      // Jaeger not running, skip
      return;
    }
    throw error;
  }
}

/**
 * Analyze a Jaeger trace and send to Flow Analyzer
 */
async function analyzeJaegerTrace(jaegerTrace) {
  try {
    const traceId = jaegerTrace.traceID;
    const spans = jaegerTrace.spans || [];

    // Convert Jaeger format to our format
    const convertedSpans = spans.map(span => {
      const tags = {};
      span.tags?.forEach(tag => {
        tags[tag.key] = tag.value;
      });

      const processTags = {};
      span.process?.tags?.forEach(tag => {
        processTags[tag.key] = tag.value;
      });

      return {
        spanId: span.spanID,
        parentSpanId: span.parentSpanID || null,
        operationName: span.operationName,
        startTime: span.startTime,
        duration: span.duration,
        status: {
          code: span.tags?.find(t => t.key === 'error') ? 'ERROR' : 'OK',
        },
        attributes: {
          'service.name': processTags['service.name'] || span.process?.serviceName || 'unknown',
          'k8s.namespace.name': processTags['k8s.namespace.name'] || tags['k8s.namespace.name'] || 'default',
          'k8s.pod.name': processTags['k8s.pod.name'] || tags['k8s.pod.name'] || 'unknown',
          'service.version': processTags['service.version'] || tags['service.version'],
          'deployment.environment': processTags['deployment.environment'] || tags['deployment.environment'] || 'development',
          ...tags,
        },
      };
    });

    // Extract operation name from first span or tags
    const operationName = spans[0]?.operationName || 
                         spans[0]?.tags?.find(t => t.key === 'operation.name')?.value ||
                         'unknown';

    // Extract UI event if available
    const uiEvent = spans[0]?.tags?.find(t => t.key === 'ui.event')?.value ||
                   spans[0]?.tags?.find(t => t.key === 'ui.action')?.value ||
                   null;

    // Filter by namespace - only process traces from allowed namespaces
    // Check namespace from all spans, not just the first one
    let traceNamespace = 'default';
    for (const span of convertedSpans) {
      const ns = span?.attributes?.['k8s.namespace.name'] || 
                 span?.attributes?.['k8s.namespace'];
      if (ns && ns !== 'default') {
        traceNamespace = ns;
        break;
      }
    }
    
    // Case-insensitive namespace matching
    // If ALLOWED_NAMESPACES is empty, allow all namespaces
    if (ALLOWED_NAMESPACES.length > 0) {
      const normalizedNamespace = traceNamespace.toLowerCase();
      const normalizedAllowed = ALLOWED_NAMESPACES.map(ns => ns.toLowerCase());
      
      if (!normalizedAllowed.includes(normalizedNamespace)) {
        console.log(`⏭️  Skipping Jaeger trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace}, not in allowed: ${ALLOWED_NAMESPACES.join(', ')})`);
        return;
      }
    }
    
    console.log(`✅ Processing Jaeger trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace})`);

    // Build trace data
    const traceData = {
      traceId,
      spans: convertedSpans,
      operationName,
      uiEvent,
    };

    // Analyze trace
    const flowGraph = flowAnalyzer.analyzeTrace(traceData);
    
    if (flowGraph) {
      console.log(`✅ Analyzed Jaeger trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace}, ${flowGraph.metadata.serviceCount} services)`);
    }
  } catch (error) {
    console.error(`❌ Error analyzing Jaeger trace:`, error.message);
  }
}

/**
 * Collect traces from Tempo
 */
async function collectFromTempo() {
  try {
    // Tempo uses POST API for search - query for recent traces
    const endTime = Math.floor(Date.now() / 1000); // Now (seconds)
    const startTime = Math.floor((Date.now() - 5 * 60 * 1000) / 1000); // 5 minutes ago (seconds)
    
    const response = await axios.post(`${TEMPO_API_URL}/api/search`, {
      limit: 100,
      start: startTime,
      end: endTime,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (response.data && response.data.traces) {
      const traces = response.data.traces;
      console.log(`📊 Found ${traces.length} traces in Tempo (last 5 minutes)`);

      // Fetch full trace details for each trace
      let analyzedCount = 0;
      for (const traceSummary of traces) {
        try {
          await fetchTempoTraceDetails(traceSummary.traceID);
          analyzedCount++;
        } catch (err) {
          console.error(`❌ Error processing trace ${traceSummary.traceID}:`, err.message);
        }
      }
      console.log(`✅ Processed ${analyzedCount}/${traces.length} traces`);
    } else {
      console.log('📊 No traces found in Tempo (or empty response)');
    }
  } catch (error) {
    // Silently fail if Tempo is not available
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      // Tempo not running, skip
      return;
    }
    console.error('❌ Error querying Tempo:', error.message);
    // Don't throw - allow collection to continue
  }
}

/**
 * Fetch full trace details from Tempo
 * @param {string} traceId - Trace ID to fetch
 * @param {string[]} targetNamespaces - Optional array of namespaces to filter by
 */
async function fetchTempoTraceDetails(traceId, targetNamespaces = []) {
  try {
    const response = await axios.get(`${TEMPO_API_URL}/api/traces/${traceId}`, {
      timeout: 5000,
    });

    if (response.data && response.data.batches) {
      // Convert Tempo format to our format
      // Tempo uses: batches[].scopeSpans[].spans[]
      const spans = [];
      response.data.batches.forEach(batch => {
        const resourceAttrs = batch.resource?.attributes || [];
        const serviceName = resourceAttrs.find(a => a.key === 'service.name')?.value?.stringValue || 'unknown';
        // Try multiple namespace attribute keys
        let namespace = resourceAttrs.find(a => a.key === 'k8s.namespace.name')?.value?.stringValue;
        if (!namespace) {
          namespace = resourceAttrs.find(a => a.key === 'k8s.namespace')?.value?.stringValue;
        }
        // If no namespace in attributes, try to infer from service name
        if (!namespace || namespace === 'default') {
          const serviceLower = serviceName.toLowerCase();
          if (serviceLower.includes('ccs') || serviceLower.startsWith('ccs-')) {
            namespace = 'ccs';
          } else if (serviceLower.includes('dbaas') || serviceLower.startsWith('dbaas-')) {
            namespace = 'dbaas';
          } else if (!namespace) {
            namespace = 'default';
          }
        }
        // Extract pod name from resource attributes or span attributes
        let podName = resourceAttrs.find(a => a.key === 'k8s.pod.name')?.value?.stringValue;
        if (!podName || podName === 'unknown') {
          // Try to get from span attributes if not in resource
          podName = span.attributes?.find(a => a.key === 'k8s.pod.name')?.value?.stringValue;
        }
        podName = podName || 'unknown-pod';
        const serviceVersion = resourceAttrs.find(a => a.key === 'service.version')?.value?.stringValue;
        
        // Iterate through scopeSpans
        batch.scopeSpans?.forEach(scopeSpan => {
          scopeSpan.spans?.forEach(span => {
            spans.push({
              spanId: span.spanId ? Buffer.from(span.spanId).toString('hex') : `span-${Date.now()}-${Math.random()}`,
              parentSpanId: span.parentSpanId ? Buffer.from(span.parentSpanId).toString('hex') : null,
              operationName: span.name || 'unknown',
              startTime: span.startTimeUnixNano || 0,
              duration: span.endTimeUnixNano && span.startTimeUnixNano 
                ? span.endTimeUnixNano - span.startTimeUnixNano 
                : 0,
              status: {
                code: span.status?.code === 2 ? 'ERROR' : 'OK',
              },
              attributes: {
                'service.name': serviceName,
                'k8s.namespace.name': namespace,
                'k8s.pod.name': podName,
                'service.version': serviceVersion,
              },
            });
          });
        });
      });

      const operationName = spans[0]?.operationName || 'unknown';
      const uiEvent = spans[0]?.attributes?.['ui.event'] || null;

      const traceData = {
        traceId,
        spans,
        operationName,
        uiEvent,
      };

      // Filter by namespace - only process traces from allowed namespaces
      // Check namespace from all spans, not just the first one
      let traceNamespace = 'default';
      for (const span of spans) {
        const ns = span?.attributes?.['k8s.namespace.name'] || 
                   span?.attributes?.['k8s.namespace'];
        if (ns && ns !== 'default') {
          traceNamespace = ns;
          break;
        }
      }
      
      // Namespace filtering - use targetNamespaces if provided, otherwise use ALLOWED_NAMESPACES
      const namespacesToCheck = targetNamespaces.length > 0 ? targetNamespaces : ALLOWED_NAMESPACES;
      
      if (namespacesToCheck.length > 0) {
        const normalizedNamespace = traceNamespace.toLowerCase();
        const normalizedAllowed = namespacesToCheck.map(ns => ns.toLowerCase());
        
        // In development, if namespace is 'default' and we have traces, allow them (they might be from local dev)
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const isDefaultNamespace = normalizedNamespace === 'default';
        
        if (!normalizedAllowed.includes(normalizedNamespace)) {
          // In development, allow 'default' namespace traces if no namespace info is available
          if (isDevelopment && isDefaultNamespace && spans.length > 0) {
            console.log(`⚠️  Trace ${traceId.substring(0, 16)}... has no namespace info (default), allowing in development mode`);
            // Don't skip - allow it through
          } else {
            console.log(`⏭️  Skipping trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace}, not in target: ${namespacesToCheck.join(', ')})`);
            return 'skipped';
          }
        }
      }
      
      console.log(`✅ Processing trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace})`);

      const flowGraph = flowAnalyzer.analyzeTrace(traceData);
      
      if (flowGraph) {
        console.log(`✅ Analyzed Tempo trace ${traceId.substring(0, 16)}... (namespace: ${traceNamespace}, ${flowGraph.metadata.serviceCount} services, ${flowGraph.nodes.length} nodes, ${flowGraph.edges.length} edges)`);
        return 'analyzed';
      } else {
        console.log(`⚠️  Could not analyze Tempo trace ${traceId.substring(0, 16)}... (${spans.length} spans)`);
        return 'failed';
      }
    }
  } catch (error) {
    console.error(`❌ Error fetching Tempo trace details:`, error.message);
    return 'error';
  }
  return null;
}

/**
 * Manually trigger trace collection for a specific namespace
 * @param {string} namespace - Namespace to collect traces from
 */
export async function collectTracesForNamespace(namespace) {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  await collectTraces(namespace);
}

/**
 * Manually trigger trace collection (all namespaces)
 */
export async function collectTracesNow() {
  await collectTraces();
}

/**
 * Get collector status
 */
export function getCollectorStatus() {
  return {
    enabled: COLLECTOR_ENABLED,
    isCollecting,
    interval: COLLECTOR_INTERVAL,
    backend: TRACING_BACKEND,
    flowAnalyzerAvailable: !!flowAnalyzer,
    allowedNamespaces: ALLOWED_NAMESPACES,
  };
}

