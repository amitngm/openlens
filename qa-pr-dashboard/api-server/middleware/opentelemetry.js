/**
 * OpenTelemetry Instrumentation
 * Exports traces to Jaeger, Tempo, or Zipkin
 */

import opentelemetry from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Jaeger exporter
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Zipkin exporter (alternative)
// import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';

// Console exporter (for development)
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const TRACING_ENABLED = process.env.TRACING_ENABLED !== 'false';
const TRACING_SERVICE_NAME = process.env.TRACING_SERVICE_NAME || 'qa-pr-dashboard-api';
const TRACING_EXPORTER = process.env.TRACING_EXPORTER || 'jaeger'; // jaeger, tempo, zipkin, console
const JAEGER_ENDPOINT = process.env.JAEGER_ENDPOINT || 'http://localhost:4318/v1/traces';
const TEMPO_ENDPOINT = process.env.TEMPO_ENDPOINT || 'http://localhost:4318/v1/traces';
const ZIPKIN_ENDPOINT = process.env.ZIPKIN_ENDPOINT || 'http://localhost:9411/api/v2/spans';

let sdk = null;

/**
 * Initialize OpenTelemetry SDK
 */
export function initializeTracing() {
  if (!TRACING_ENABLED) {
    console.log('📊 Tracing is disabled (set TRACING_ENABLED=true to enable)');
    return;
  }

  try {
    let exporter;

    switch (TRACING_EXPORTER.toLowerCase()) {
      case 'jaeger':
        exporter = new OTLPTraceExporter({
          url: JAEGER_ENDPOINT,
          headers: {},
        });
        console.log(`📊 Initializing Jaeger tracing: ${JAEGER_ENDPOINT}`);
        break;

      case 'tempo':
        exporter = new OTLPTraceExporter({
          url: TEMPO_ENDPOINT,
          headers: {},
        });
        console.log(`📊 Initializing Tempo tracing: ${TEMPO_ENDPOINT}`);
        break;

      case 'zipkin':
        // For Zipkin, you'd use ZipkinExporter
        // exporter = new ZipkinExporter({ url: ZIPKIN_ENDPOINT });
        console.log(`📊 Zipkin exporter not fully implemented, using OTLP`);
        exporter = new OTLPTraceExporter({
          url: ZIPKIN_ENDPOINT,
        });
        break;

      case 'console':
      default:
        exporter = new ConsoleSpanExporter();
        console.log('📊 Using console exporter for tracing');
        break;
    }

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: TRACING_SERVICE_NAME,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
      traceExporter: exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable fs instrumentation to reduce noise
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });

    sdk.start();
    console.log('✅ OpenTelemetry tracing initialized');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk.shutdown()
        .then(() => console.log('📊 Tracing terminated'))
        .catch((error) => console.error('Error terminating tracing', error))
        .finally(() => process.exit(0));
    });
  } catch (error) {
    console.error('❌ Failed to initialize tracing:', error.message);
    console.log('⚠️  Continuing without distributed tracing');
  }
}

/**
 * Get OpenTelemetry tracer
 */
export function getTracer(name = TRACING_SERVICE_NAME) {
  if (!TRACING_ENABLED) {
    return null;
  }
  return opentelemetry.trace.getTracer(name);
}

/**
 * Create a span for an operation
 */
export function createSpan(tracer, spanName, options = {}) {
  if (!tracer) {
    return {
      end: () => {},
      setAttribute: () => {},
      addEvent: () => {},
      setStatus: () => {},
    };
  }

  const span = tracer.startSpan(spanName, options);
  return span;
}

/**
 * Shutdown tracing SDK
 */
export async function shutdownTracing() {
  if (sdk) {
    await sdk.shutdown();
    console.log('📊 Tracing SDK shut down');
  }
}
