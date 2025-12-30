/**
 * Flow Analyzer Service
 * Analyzes traces and builds service dependency graphs
 * This is a standalone service that can be enabled/disabled
 */

// In-memory storage for flow graphs (can be moved to MongoDB later)
let flowGraphsCache = new Map();
let serviceDependenciesCache = new Map();

/**
 * Analyze a trace and extract service flow information
 * @param {Object} traceData - Trace data from OpenTelemetry/Tempo
 * @returns {Object} Flow graph representation
 */
export function analyzeTrace(traceData) {
  try {
    const { traceId, spans, operationName, uiEvent } = traceData;
    
    if (!spans || spans.length === 0) {
      return null;
    }

    // Build service dependency graph from spans
    const nodes = new Map();
    const edges = new Map();
    const spanMap = new Map();

    // First pass: collect all spans and create nodes
    spans.forEach(span => {
      const serviceName = span.attributes?.['service.name'] || 
                         span.attributes?.['k8s.deployment.name'] ||
                         'unknown-service';
      const namespace = span.attributes?.['k8s.namespace.name'] || 
                       span.attributes?.['k8s.namespace'] ||
                       'default';
      const podName = span.attributes?.['k8s.pod.name'] || 'unknown-pod';
      
      const nodeId = `${namespace}/${serviceName}`;
      
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          service: {
            name: serviceName,
            namespace: namespace,
            pod: podName,
            version: span.attributes?.['service.version'] || 'unknown',
          },
          metrics: {
            requestCount: 0,
            errorCount: 0,
            totalLatency: 0,
            latencies: [],
          },
          status: 'healthy',
        });
      }

      // Update metrics
      const node = nodes.get(nodeId);
      node.metrics.requestCount++;
      if (span.status?.code === 'ERROR') {
        node.metrics.errorCount++;
        node.status = 'degraded';
      }
      if (span.duration) {
        node.metrics.totalLatency += span.duration;
        node.metrics.latencies.push(span.duration);
      }

      spanMap.set(span.spanId, { ...span, nodeId, serviceName, namespace });
    });

    // Second pass: create edges based on parent-child relationships
    spans.forEach(span => {
      if (span.parentSpanId) {
        const parentSpan = spanMap.get(span.parentSpanId);
        const currentSpan = spanMap.get(span.spanId);
        
        if (parentSpan && currentSpan && parentSpan.nodeId !== currentSpan.nodeId) {
          const edgeKey = `${parentSpan.nodeId}->${currentSpan.nodeId}`;
          
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, {
              from: parentSpan.nodeId,
              to: currentSpan.nodeId,
              callCount: 0,
              errorCount: 0,
              totalLatency: 0,
              latencies: [],
            });
          }

          const edge = edges.get(edgeKey);
          edge.callCount++;
          if (span.status?.code === 'ERROR') {
            edge.errorCount++;
          }
          if (span.duration) {
            edge.totalLatency += span.duration;
            edge.latencies.push(span.duration);
          }
        }
      }
    });

    // Calculate final metrics
    const finalNodes = Array.from(nodes.values()).map(node => ({
      ...node,
      metrics: {
        ...node.metrics,
        avgLatency: node.metrics.requestCount > 0 
          ? Math.round(node.metrics.totalLatency / node.metrics.requestCount) 
          : 0,
        p50Latency: calculatePercentile(node.metrics.latencies, 50),
        p95Latency: calculatePercentile(node.metrics.latencies, 95),
        p99Latency: calculatePercentile(node.metrics.latencies, 99),
      },
    }));

    const finalEdges = Array.from(edges.values()).map(edge => ({
      ...edge,
      errorRate: edge.callCount > 0 ? edge.errorCount / edge.callCount : 0,
      avgLatency: edge.callCount > 0 
        ? Math.round(edge.totalLatency / edge.callCount) 
        : 0,
    }));

    // Build span sequence for timeline view (sorted by startTime)
    // This shows all pod calls in chronological order based on epoch/timestamp
    const spanSequence = spans
      .map(span => {
        // Safely extract all properties with fallbacks
        const podName = span.attributes?.['k8s.pod.name'] || 
                       span.attributes?.['k8s.pod'] || 
                       'unknown-pod';
        const serviceName = span.attributes?.['service.name'] || 
                           span.attributes?.['k8s.deployment.name'] ||
                           'unknown-service';
        const namespace = span.attributes?.['k8s.namespace.name'] || 
                         span.attributes?.['k8s.namespace'] || 
                         'default';
        const operationName = span.operationName || 
                             span.attributes?.['operation.name'] ||
                             span.attributes?.['http.method'] ||
                             'unknown';
        const statusCode = span.status?.code || 'OK';
        
        return {
          spanId: span.spanId || `span-${Date.now()}-${Math.random()}`,
          operationName: operationName,
          startTime: span.startTime || 0,
          duration: span.duration || 0,
          endTime: (span.startTime || 0) + (span.duration || 0),
          podName: podName,
          serviceName: serviceName,
          namespace: namespace,
          parentSpanId: span.parentSpanId || null,
          status: statusCode === 'ERROR' || statusCode === 2 ? 'error' : 'success',
        };
      })
      .filter(seq => seq.startTime > 0) // Only include spans with valid timestamps
      .sort((a, b) => a.startTime - b.startTime);

    // Build flow graph
    const flowGraph = {
      flowId: `flow-${traceId}`,
      traceId: traceId,
      operationName: operationName || 'unknown',
      uiEvent: uiEvent || null,
      startTime: spans.length > 0 ? Math.min(...spans.map(s => s.startTime || 0)) : Date.now() * 1000000,
      endTime: spans.length > 0 ? Math.max(...spans.map(s => (s.startTime || 0) + (s.duration || 0))) : Date.now() * 1000000,
      duration: spans.length > 0 
        ? Math.max(...spans.map(s => (s.startTime || 0) + (s.duration || 0))) - 
          Math.min(...spans.map(s => s.startTime || 0))
        : 0,
      nodes: finalNodes,
      edges: finalEdges,
      spanSequence: spanSequence, // Add span sequence for timeline view
      metadata: {
        namespace: spans[0]?.attributes?.['k8s.namespace.name'] || 
                  spans[0]?.attributes?.['k8s.namespace'] || 
                  'default',
        totalSpans: spans.length,
        serviceCount: finalNodes.length,
        errorCount: finalNodes.reduce((sum, n) => sum + n.metrics.errorCount, 0),
        // Track which namespaces are involved in this flow
        namespaces: [...new Set(finalNodes.map(n => n.service.namespace))],
        // Count services per namespace
        servicesByNamespace: finalNodes.reduce((acc, node) => {
          const ns = node.service.namespace || 'default';
          if (!acc[ns]) acc[ns] = [];
          acc[ns].push(node.service.name);
          return acc;
        }, {}),
      },
    };

    // Cache the flow graph (even single-service flows are useful)
    flowGraphsCache.set(traceId, flowGraph);
    console.log(`📊 Cached flow graph: ${flowGraph.flowId} (${finalNodes.length} nodes, ${finalEdges.length} edges, namespace: ${flowGraph.metadata.namespace})`);
    
    // Update service dependencies cache
    finalEdges.forEach(edge => {
      const depKey = `${edge.from}->${edge.to}`;
      if (!serviceDependenciesCache.has(depKey)) {
        serviceDependenciesCache.set(depKey, {
          sourceService: edge.from.split('/')[1] || edge.from,
          targetService: edge.to.split('/')[1] || edge.to,
          sourceNamespace: edge.from.split('/')[0] || 'default',
          targetNamespace: edge.to.split('/')[0] || 'default',
          callCount: 0,
          errorCount: 0,
          totalLatency: 0,
          lastSeen: Date.now(),
        });
      }
      
      const dep = serviceDependenciesCache.get(depKey);
      dep.callCount += edge.callCount;
      dep.errorCount += edge.errorCount;
      dep.totalLatency += edge.totalLatency;
      dep.lastSeen = Date.now();
    });

    return flowGraph;
  } catch (error) {
    console.error('Error analyzing trace:', error);
    return null;
  }
}

/**
 * Calculate percentile from array of values
 */
function calculatePercentile(values, percentile) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] || 0;
}

/**
 * Get flow graph by trace ID
 */
export function getFlowGraph(traceId) {
  return flowGraphsCache.get(traceId) || null;
}

/**
 * Get all flow graphs filtered by criteria
 */
export function getFlowGraphs(filters = {}) {
  const { operationName, namespace, startTime, endTime, environment } = filters;
  let flows = Array.from(flowGraphsCache.values());

  if (operationName) {
    flows = flows.filter(f => f.operationName === operationName);
  }

  if (namespace) {
    // Filter flows where ANY service/node is in the selected namespace
    // This allows flows to be shown even if the API server is in a different namespace
    flows = flows.filter(f => {
      const targetNamespace = namespace.toLowerCase();
      // Check if any node in the flow is in the target namespace
      return f.nodes.some(node => {
        const nodeNamespace = (node.service?.namespace || 'default').toLowerCase();
        return nodeNamespace === targetNamespace;
      });
    });
  }

  if (startTime) {
    flows = flows.filter(f => f.startTime >= startTime);
  }

  if (endTime) {
    flows = flows.filter(f => f.endTime <= endTime);
  }

  if (environment) {
    flows = flows.filter(f => f.metadata.environment === environment);
  }

  return flows.sort((a, b) => b.startTime - a.startTime);
}

/**
 * Get service dependency graph
 */
export function getServiceDependencies(filters = {}) {
  const { namespace, serviceName } = filters;
  let dependencies = Array.from(serviceDependenciesCache.values());

  if (namespace) {
    dependencies = dependencies.filter(d => 
      d.sourceNamespace === namespace || d.targetNamespace === namespace
    );
  }

  if (serviceName) {
    dependencies = dependencies.filter(d => 
      d.sourceService === serviceName || d.targetService === serviceName
    );
  }

  // Build graph structure
  const nodes = new Set();
  const edges = dependencies.map(dep => {
    const sourceId = `${dep.sourceNamespace}/${dep.sourceService}`;
    const targetId = `${dep.targetNamespace}/${dep.targetService}`;
    nodes.add(sourceId);
    nodes.add(targetId);

    return {
      from: sourceId,
      to: targetId,
      callCount: dep.callCount,
      errorRate: dep.callCount > 0 ? dep.errorCount / dep.callCount : 0,
      avgLatency: dep.callCount > 0 
        ? Math.round(dep.totalLatency / dep.callCount) 
        : 0,
      lastSeen: dep.lastSeen,
    };
  });

  return {
    nodes: Array.from(nodes).map(nodeId => {
      const [namespace, service] = nodeId.split('/');
      return {
        id: nodeId,
        service: {
          name: service,
          namespace: namespace,
        },
      };
    }),
    edges: edges,
  };
}

/**
 * Get operation statistics
 */
export function getOperationStats(operationName, startTime, endTime) {
  const flows = getFlowGraphs({ operationName, startTime, endTime });
  
  if (flows.length === 0) {
    return null;
  }

  const totalRequests = flows.length;
  const successCount = flows.filter(f => 
    f.metadata.errorCount === 0
  ).length;
  const errorCount = totalRequests - successCount;

  const allLatencies = flows.flatMap(f => 
    f.nodes.flatMap(n => n.metrics.latencies || [])
  );

  return {
    operationName,
    totalRequests,
    successCount,
    errorCount,
    avgLatency: allLatencies.length > 0
      ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
      : 0,
    p50Latency: calculatePercentile(allLatencies, 50),
    p95Latency: calculatePercentile(allLatencies, 95),
    p99Latency: calculatePercentile(allLatencies, 99),
    services: flows.reduce((acc, flow) => {
      flow.nodes.forEach(node => {
        const serviceName = node.service.name;
        if (!acc[serviceName]) {
          acc[serviceName] = {
            name: serviceName,
            requestCount: 0,
            errorCount: 0,
          };
        }
        acc[serviceName].requestCount += node.metrics.requestCount;
        acc[serviceName].errorCount += node.metrics.errorCount;
      });
      return acc;
    }, {}),
  };
}

/**
 * Clear cache (for testing or maintenance)
 */
export function clearCache() {
  flowGraphsCache.clear();
  serviceDependenciesCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    flowGraphsCount: flowGraphsCache.size,
    dependenciesCount: serviceDependenciesCache.size,
  };
}

