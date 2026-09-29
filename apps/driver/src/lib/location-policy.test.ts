import { describe, expect, it } from 'vitest';
import { backoffMs } from './backoff';
import {
  isLowBattery,
  locationPolicy,
  MAX_KEEP_ALIVE_MS,
  requestChanged,
  trackingPhase,
} from './location-policy';
import { STREAM_DEAD_AFTER_MS, streamIsStale } from './sse';

describe('trackingPhase', () => {
  it('follows the ride first, then the shift', () => {
    expect(trackingPhase(false, null)).toBe('off');
    expect(trackingPhase(true, null)).toBe('idle');
    expect(trackingPhase(true, 'driver_assigned')).toBe('to_pickup');
    expect(trackingPhase(true, 'driver_arrived')).toBe('waiting');
    expect(trackingPhase(true, 'in_progress')).toBe('on_trip');
    // an operator-assigned ride keeps GPS on even if the shift flag lags
    expect(trackingPhase(false, 'in_progress')).toBe('on_trip');
    expect(trackingPhase(true, 'completed')).toBe('idle');
  });
});

describe('locationPolicy', () => {
  it('is off when offline: no GPS at all', () => {
    expect(locationPolicy('off')).toBeNull();
  });

  it('paces by phase: idle ~15 s, to the pickup ~4 s, on a trip ~3 s', () => {
    expect(locationPolicy('idle')!.send).toMatchObject({ intervalMs: 15_000, moveM: 50 });
    expect(locationPolicy('to_pickup')!.send.intervalMs).toBe(4_000);
    expect(locationPolicy('on_trip')!.send.intervalMs).toBe(3_000);
    for (const phase of ['idle', 'to_pickup', 'waiting', 'on_trip'] as const) {
      const p = locationPolicy(phase)!;
      expect(p.request.accuracy).toBe('high');
      // the provider delivers at least as often as the reporter needs
      expect(p.request.timeIntervalMs).toBeLessThanOrEqual(p.send.intervalMs);
      // dispatch drops positions older than 120 s
      expect(p.send.keepAliveMs).toBeLessThanOrEqual(MAX_KEEP_ALIVE_MS);
    }
  });

  it('doubles the intervals below 15 % battery unless charging', () => {
    const normal = locationPolicy('on_trip')!;
    const low = locationPolicy('on_trip', { level: 0.1, charging: false })!;
    expect(low.saving).toBe(true);
    expect(low.send.intervalMs).toBe(normal.send.intervalMs * 2);
    expect(low.send.minGapMs).toBe(normal.send.minGapMs * 2);
    expect(low.request.timeIntervalMs).toBe(normal.request.timeIntervalMs * 2);
    expect(locationPolicy('on_trip', { level: 0.1, charging: true })!.saving).toBe(false);
    // the idle keep-alive is capped so the driver stays in dispatch
    expect(locationPolicy('idle', { level: 0.05, charging: false })!.send.keepAliveMs).toBe(
      MAX_KEEP_ALIVE_MS,
    );
  });

  it('knows when the provider must be restarted', () => {
    const idle = locationPolicy('idle');
    const trip = locationPolicy('on_trip');
    expect(requestChanged(idle, trip)).toBe(true);
    expect(requestChanged(idle, locationPolicy('idle'))).toBe(false);
    expect(requestChanged(null, idle)).toBe(true);
    expect(requestChanged(null, null)).toBe(false);
  });
});

describe('isLowBattery', () => {
  it('needs a known level under 15 % and no charger', () => {
    expect(isLowBattery({ level: 0.14, charging: false })).toBe(true);
    expect(isLowBattery({ level: 0.15, charging: false })).toBe(false);
    expect(isLowBattery({ level: null, charging: false })).toBe(false);
    expect(isLowBattery({ level: -1, charging: false })).toBe(false);
    expect(isLowBattery(null)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('doubles up to the cap, with jitter between 50 and 100 %', () => {
    expect(backoffMs(0, 1_000, 30_000, 1)).toBe(1_000);
    expect(backoffMs(1, 1_000, 30_000, 1)).toBe(2_000);
    expect(backoffMs(3, 1_000, 30_000, 1)).toBe(8_000);
    expect(backoffMs(10, 1_000, 30_000, 1)).toBe(30_000);
    expect(backoffMs(10, 1_000, 30_000, 0)).toBe(15_000);
    expect(backoffMs(-5, 1_000, 30_000, 1)).toBe(1_000);
  });
});

describe('streamIsStale', () => {
  it('trusts the stream for one server heartbeat plus a grace period', () => {
    expect(streamIsStale(null, 0)).toBe(true);
    expect(streamIsStale(1_000, 1_000 + STREAM_DEAD_AFTER_MS)).toBe(false);
    expect(streamIsStale(1_000, 1_001 + STREAM_DEAD_AFTER_MS)).toBe(true);
  });
});
