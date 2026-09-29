import { describe, expect, it } from 'vitest';
import { OrderAttempts, orderKey } from './order-attempt';

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const order = {
  quoteId: 'q1',
  class: 'economy',
  paymentMethod: 'cash',
  pickup: { address: 'Bozor', landmark: null },
  dropoff: { address: 'Vokzal', landmark: null },
  comment: null,
};

describe('order attempts', () => {
  it('keeps the id while an unanswered order is retried', () => {
    const attempts = new OrderAttempts(ids());
    const key = orderKey(order);
    expect(attempts.idFor(key)).toBe('id-1');
    attempts.settle('unknown');
    expect(attempts.idFor(key)).toBe('id-1');
    expect(attempts.pending).toBe('id-1');
  });

  it('starts a new attempt after a created or refused order', () => {
    const attempts = new OrderAttempts(ids());
    const key = orderKey(order);
    attempts.idFor(key);
    attempts.settle('created');
    expect(attempts.pending).toBeNull();
    expect(attempts.idFor(key)).toBe('id-2');
    attempts.settle('rejected');
    expect(attempts.idFor(key)).toBe('id-3');
  });

  it('gives a changed order a new id (the API ignores the body of a repeat)', () => {
    const attempts = new OrderAttempts(ids());
    const first = attempts.idFor(orderKey(order));
    attempts.settle('unknown');
    const comfort = attempts.idFor(orderKey({ ...order, class: 'comfort' }));
    expect(comfort).not.toBe(first);
    const withComment = attempts.idFor(
      orderKey({ ...order, class: 'comfort', comment: 'Darvoza oldida' }),
    );
    expect(withComment).not.toBe(comfort);
    expect(orderKey(order)).toBe(orderKey({ ...order }));
  });

  it('counts people, sharing, a woman driver and a seat as part of the order', () => {
    const plain = orderKey(order);
    // the defaults are the plain order (an older API gets the same key)
    expect(orderKey({ ...order, passengers: 1, shareable: false, fareMode: 'car' })).toBe(plain);
    expect(orderKey({ ...order, passengers: 2 })).not.toBe(plain);
    expect(orderKey({ ...order, shareable: true })).not.toBe(plain);
    expect(orderKey({ ...order, womenOnly: true })).not.toBe(plain);
    expect(orderKey({ ...order, fareMode: 'seat' })).not.toBe(plain);
  });
});
