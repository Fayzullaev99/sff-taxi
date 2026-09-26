import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTBOX_HANDLERS, type OutboxHandler } from '../src/core/outbox/handler.js';
import { WorkerModule } from '../src/worker.module.js';
import { WorkerRuntime } from '../src/worker-runtime.js';

const PORT = 3297;

describe('worker', () => {
  let ctx: INestApplicationContext;

  beforeAll(async () => {
    process.env.WORKER_HTTP_PORT = String(PORT);
    process.env.DISPATCH_TICK_MS = '200';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    ctx = await moduleRef.init();
    await ctx.get(WorkerRuntime).start();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  it('wires every outbox handler', () => {
    const names = ctx.get<OutboxHandler[]>(OUTBOX_HANDLERS).map((h) => h.name);
    expect(names).toEqual(expect.arrayContaining(['dispatch']));
  });

  it('reports health and metrics with the dispatch loop running', async () => {
    // healthy once the outbox loop has completed a cycle
    let health = await fetch(`http://127.0.0.1:${PORT}/health`);
    for (let i = 0; i < 50 && health.status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      health = await fetch(`http://127.0.0.1:${PORT}/health`);
    }
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', database: 'up' });
    const metrics = await fetch(`http://127.0.0.1:${PORT}/metrics`);
    expect(await metrics.text()).toMatch(/outbox_pending_events/);
  });
});
