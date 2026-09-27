import { describe, expect, it } from 'vitest';
import { parseRealtimeEvent, reconnectDelayMs, SseParser } from './sse';

const OFFER =
  '{"type":"offer.new","offerId":"o1","rideId":"r1","expiresAt":"2026-09-26T10:00:15Z"}';

describe('SseParser', () => {
  it('parses what the API sends, split anywhere', () => {
    const stream = `retry: 3000\n\ndata: {"type":"ready"}\n\n: ping\n\ndata: ${OFFER}\r\n\r\n`;
    for (let cut = 0; cut <= stream.length; cut++) {
      const p = new SseParser();
      const events = [...p.push(stream.slice(0, cut)), ...p.push(stream.slice(cut))];
      expect(events).toEqual([
        { event: 'message', data: '{"type":"ready"}' },
        { event: 'message', data: OFFER },
      ]);
      expect(p.retryMs).toBe(3000);
    }
  });

  it('joins multi-line data and keeps event names', () => {
    const p = new SseParser();
    expect(p.push('event: note\ndata: a\ndata:b\n\n')).toEqual([{ event: 'note', data: 'a\nb' }]);
  });

  it('ignores comments and empty events', () => {
    const p = new SseParser();
    expect(p.push(': ping\n\n\n\n')).toEqual([]);
  });
});

describe('parseRealtimeEvent', () => {
  it('accepts the driver events', () => {
    expect(parseRealtimeEvent(OFFER)).toEqual({
      type: 'offer.new',
      offerId: 'o1',
      rideId: 'r1',
      expiresAt: '2026-09-26T10:00:15Z',
    });
    expect(
      parseRealtimeEvent('{"type":"offer.closed","offerId":"o1","rideId":"r1","status":"taken"}'),
    ).toEqual({ type: 'offer.closed', offerId: 'o1', rideId: 'r1', status: 'taken' });
    expect(
      parseRealtimeEvent('{"type":"ride.updated","rideId":"r1","status":"cancelled"}'),
    ).toEqual({ type: 'ride.updated', rideId: 'r1', status: 'cancelled' });
    expect(parseRealtimeEvent('{"type":"driver.updated","status":"blocked"}')).toEqual({
      type: 'driver.updated',
      status: 'blocked',
    });
    expect(
      parseRealtimeEvent(
        '{"type":"intercity.updated","tripId":"t1","bookingId":null,"status":"boarding"}',
      ),
    ).toEqual({ type: 'intercity.updated', tripId: 't1', bookingId: null, status: 'boarding' });
    expect(
      parseRealtimeEvent(
        '{"type":"offer.closed","offerId":"o2","rideId":"r2","driverId":"d1","status":"withdrawn"}',
      ),
    ).toEqual({ type: 'offer.closed', offerId: 'o2', rideId: 'r2', status: 'withdrawn' });
  });

  it('refuses malformed and unknown events', () => {
    expect(parseRealtimeEvent('{"type":"offer.new","offerId":"o1"}')).toBeNull();
    expect(parseRealtimeEvent('{"type":"ride.updated"}')).toBeNull();
    expect(parseRealtimeEvent('{"type":"ping"}')).toBeNull();
    expect(parseRealtimeEvent('null')).toBeNull();
    expect(parseRealtimeEvent('not json')).toBeNull();
  });
});

describe('reconnectDelayMs', () => {
  it('backs off exponentially with jitter up to 30 s', () => {
    expect(reconnectDelayMs(0, 1)).toBe(1_000);
    expect(reconnectDelayMs(0, 0)).toBe(500);
    expect(reconnectDelayMs(3, 1)).toBe(8_000);
    expect(reconnectDelayMs(20, 1)).toBe(30_000);
  });
});
