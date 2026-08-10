/**
 * observability — src/tracing.ts
 *
 * Bootstrap OpenTelemetry NodeSDK com instrumentacao HTTP, export OTLP opcional
 * ou InMemorySpanExporter para testes, e helpers de trace_id / shutdown.
 */

import { context, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { ServiceIdentity } from './types.js';

/** Armazena spans finalizados em memoria — util para testes e modo sem OTLP. */
export class InMemorySpanExporter implements SpanExporter {
  readonly finishedSpans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void): void {
    this.finishedSpans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  reset(): void {
    this.finishedSpans.length = 0;
  }
}

let sdk: NodeSDK | undefined;
let memoryExporter: InMemorySpanExporter | undefined;

export interface StartTracingOptions {
  identity: ServiceIdentity;
  otlpUrl?: string;
}

export function startTracing(options: StartTracingOptions): InMemorySpanExporter | undefined {
  if (sdk) {
    return memoryExporter;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: options.identity.service,
    [ATTR_SERVICE_VERSION]: options.identity.version,
    'deployment.id': options.identity.deploymentId,
  });

  const instrumentations = [new HttpInstrumentation()];

  if (options.otlpUrl) {
    sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({ url: options.otlpUrl }),
      instrumentations,
    });
    memoryExporter = undefined;
  } else {
    memoryExporter = new InMemorySpanExporter();
    sdk = new NodeSDK({
      resource,
      spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
      instrumentations,
    });
  }

  sdk.start();
  return memoryExporter;
}

export function getTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId;
  if (!traceId || traceId === '00000000000000000000000000000000') {
    return undefined;
  }
  return traceId;
}

export function getMemoryExporter(): InMemorySpanExporter | undefined {
  return memoryExporter;
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = undefined;
    memoryExporter = undefined;
  }
}
