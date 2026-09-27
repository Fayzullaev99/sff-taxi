/**
 * The panel's side of API wave 3: offline markers, refund and appeal events, card payments,
 * payouts, reason labels and owed cancellation fees.
 */
import { describe, expect, it } from 'vitest';
import { intentsQuery } from '../api/queries';
import { applyPositions, hideDropped, rememberDropped, staleKeys } from '../api/realtime';
import type { LiveBoard, RideEvent } from '../api/types';
import { reasonText } from './format';
import { entryProblems } from './ops';
import { intentTotals } from './payments';
import { eventDetail } from './rides';

const driver = (id: string, over: Partial<LiveBoard['drivers'][number]> = {}) => ({
  id,
  name: id,
  lat: 40.49,
  lng: 68.78,
  heading: null,
  locatedAt: '2026-09-26T07:00:00.000Z',
  onlineSince: null,
  plate: '20A123BC',
  class: 'economy' as const,
  rideId: null,
  rideStatus: null,
  offeredRideId: null,
  state: 'free' as const,
  ...over,
});

describe('offline drivers on the live map', () => {
  const board: LiveBoard = { drivers: [driver('d1'), driver('d2')], rides: [] };
  const at = '2026-09-26T07:00:05.000Z';

  it('drops the markers of drivers the batch lists offline and asks for a refetch', () => {
    const next = applyPositions(
      board,
      [{ id: 'd1', lat: 40.5, lng: 68.79, heading: 90, at, busy: false }],
      ['d2'],
    );
    expect(next.board.drivers[0]).toMatchObject({ lat: 40.5, lng: 68.79 });
    expect(next.board.drivers[1]).toMatchObject({ lat: null, lng: null, heading: null });
    // the driver may be off shift: the board is fetched again
    expect(next.missing).toBe(true);
    // an id both in the batch and offline (a stale event) is not dropped
    expect(
      applyPositions(board, [{ id: 'd2', lat: 1, lng: 2, heading: null, at, busy: false }], ['d2'])
        .board.drivers[1],
    ).toMatchObject({ lat: 1, lng: 2 });
    // nobody on the board left: nothing changes, nothing to refetch
    const same = applyPositions(board, [], ['d9']);
    expect(same.board).toBe(board);
    expect(same.missing).toBe(false);
  });

  it('keeps dropped markers off a refetched board until a newer fix arrives', () => {
    const memory = new Map<string, string | null>();
    rememberDropped(memory, board, [], ['d2']);
    expect(memory.get('d2')).toBe('2026-09-26T07:00:00.000Z');
    // the refetched board still carries the old fix
    const hidden = hideDropped(board, memory);
    expect(hidden.drivers[1]).toMatchObject({ lat: null, lng: null });
    expect(hidden.drivers[0]).toBe(board.drivers[0]);
    // a newer fix on a later board brings the car back
    const moved: LiveBoard = {
      ...board,
      drivers: [board.drivers[0]!, driver('d2', { locatedAt: at })],
    };
    expect(hideDropped(moved, memory)).toBe(moved);
    // the driver in a later batch clears the memory
    rememberDropped(
      memory,
      board,
      [{ id: 'd2', lat: 1, lng: 1, heading: null, at, busy: false }],
      [],
    );
    expect(memory.size).toBe(0);
    expect(hideDropped(board, memory)).toBe(board);
  });

  it('refreshes refunds and appeals on their events', () => {
    expect(staleKeys({ type: 'ride.refund', rideId: 'r1', status: 'refunded', amount: 1 })).toEqual(
      [['ride', 'r1'], ['refunds'], ['payments']],
    );
    expect(
      staleKeys({ type: 'appeal.updated', appealId: 'a1', driverId: 'd1', status: 'resolved' }),
    ).toEqual([['appeals'], ['driver', 'd1']]);
  });
});

describe('card payments and payouts', () => {
  it('builds the intents filter query without empty values', () => {
    expect(
      intentsQuery({
        purpose: 'topup',
        status: 'failed',
        provider: '',
        phone: '+998901234000',
        from: '2026-09-01',
        to: '',
      }),
    ).toBe('purpose=topup&status=failed&phone=%2B998901234000&from=2026-09-01');
    expect(intentsQuery({})).toBe('');
  });

  it('totals the summary per purpose, every status present', () => {
    const t = intentTotals([
      { purpose: 'ride', status: 'paid', count: 3, amount: 30_000 },
      { purpose: 'ride', status: 'refunded', count: 1, amount: 9000 },
      { purpose: 'topup', status: 'expired', count: 2, amount: 40_000 },
    ]);
    expect(t.ride.paid).toEqual({ count: 3, amount: 30_000 });
    expect(t.ride.byStatus.refunded).toEqual({ count: 1, amount: 9000 });
    expect(t.topup.paid).toEqual({ count: 0, amount: 0 });
    expect(t.topup.byStatus.expired.count).toBe(2);
    expect(t.ride.byStatus.pending).toEqual({ count: 0, amount: 0 });
  });

  it('caps a payout at what can be paid out now', () => {
    expect(entryProblems('payout', 30_000, 'Humo *1234', 25_000).amount).toMatch(/25 000/);
    expect(entryProblems('payout', 25_000, 'Humo *1234', 25_000)).toEqual({});
    expect(entryProblems('payout', 1000, 'Humo *1234', -500).amount).toMatch(/ 0 so‘m/);
  });
});

describe('reason labels and owed fees in the timeline', () => {
  const e = (type: string, data: Record<string, unknown>, reasonLabel?: string): RideEvent => ({
    id: type,
    type,
    actor: 'driver',
    data,
    at: '2026-09-26T07:00:00.000Z',
    ...(reasonLabel ? { reasonLabel } : {}),
  });
  const names = (id: string) => (id === 'd1' ? 'Aziz' : null);
  const labels = {
    decline: { too_far: 'Juda uzoq' },
    driverCancel: { car_problem: 'Avtomobil nosoz' },
    release: { reassigned: 'Operator boshqa haydovchiga berdi' },
  };

  it('reads the API’s label first, then the reasons table, then the text as sent', () => {
    expect(eventDetail(e('offer_declined', { reason: 'x' }, 'Label'), names)).toBe('Label');
    expect(eventDetail(e('offer_declined', { kind: 'broadcast', reason: 'too_far' }), names)).toBe(
      'e’lon, Juda uzoq',
    );
    expect(eventDetail(e('offer_declined', { reason: 'o‘zim' }), names, labels)).toBe('o‘zim');
    expect(
      eventDetail(
        e('driver_released', { driverId: 'd1', reason: 'x', reasonCode: 'car_problem' }),
        names,
        labels,
      ),
    ).toBe('Aziz, Avtomobil nosoz');
    expect(
      eventDetail(e('driver_released', { driverId: 'd1', reason: 'reassigned' }), names, labels),
    ).toBe('Aziz, Operator boshqa haydovchiga berdi');
    expect(reasonText(labels.decline, 'too_far')).toBe('Juda uzoq');
    expect(reasonText(labels.decline, 'toString')).toBe('toString');
    expect(reasonText(undefined, null)).toBeNull();
  });

  it('describes owed fees, waivers and card payments', () => {
    expect(eventDetail(e('owed_fee_added', { amount: 3000, rides: ['r0'] }), names)).toMatch(
      /3 000 so‘m naqd olinadi/,
    );
    expect(eventDetail(e('fee_waived', { amount: 3000, note: 'Haydovchi kechikdi' }), names)).toBe(
      '3 000 so‘m, Haydovchi kechikdi',
    );
    expect(eventDetail(e('completed', { fare: 9000, owedFee: 3000 }), names)).toBe(
      'jami 9 000 so‘m, qarz 3 000 so‘m olindi',
    );
    expect(eventDetail(e('paid', { provider: 'click', amount: 12_000 }), names)).toBe(
      '12 000 so‘m, Click',
    );
  });
});
