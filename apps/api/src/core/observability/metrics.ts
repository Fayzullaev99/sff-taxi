import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/** One registry per process (API or worker), with Node.js runtime metrics included. */
export function createRegistry(service: 'api' | 'worker'): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export function httpDurationHistogram(registry: Registry) {
  return new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route template and status',
    // route is the Express template (/v1/branches/:id), never the raw URL, to keep cardinality bounded
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
}
