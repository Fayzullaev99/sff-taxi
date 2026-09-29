import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import {
  acceptOffer,
  isTransient,
  optimisticStatus,
  runRideStep,
  stepReached,
  withRetry,
} from './ride-actions';

const noWait = { wait: async () => {}, random: () => 1 };
const offline = () => new ApiError(0, 'offline');
const conflict = (m = 'Buyurtma holati mos emas: driver_arrived') => new ApiError(409, m);

describe('stepReached / optimisticStatus', () => {
  it('knows the order of a ride', () => {
    expect(stepReached('driver_assigned', 'arrive')).toBe(false);
    expect(stepReached('driver_arrived', 'arrive')).toBe(true);
    expect(stepReached('in_progress', 'arrive')).toBe(true);
    expect(stepReached('driver_arrived', 'start')).toBe(false);
    expect(stepReached('completed', 'complete')).toBe(true);
    expect(stepReached('cancelled', 'complete')).toBe(false);
    expect(stepReached(null, 'arrive')).toBe(false);
  });

  it('shows the next status while the step is on its way', () => {
    expect(optimisticStatus('driver_assigned', 'arrive')).toBe('driver_arrived');
    expect(optimisticStatus('driver_arrived', 'start')).toBe('in_progress');
    expect(optimisticStatus('in_progress', 'arrive')).toBe('in_progress');
    expect(optimisticStatus('driver_assigned', null)).toBe('driver_assigned');
  });
});

describe('isTransient', () => {
  it('retries only lost answers and gateway trouble', () => {
    expect(isTransient(offline())).toBe(true);
    expect(isTransient(new ApiError(503, 'x'))).toBe(true);
    expect(isTransient(new ApiError(500, 'x'))).toBe(false);
    expect(isTransient(conflict())).toBe(false);
    expect(isTransient(new Error('x'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('re-sends after network failures with growing waits', async () => {
    const waits: number[] = [];
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, {
      attempts: 5,
      baseMs: 1_000,
      maxMs: 10_000,
      random: () => 1,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(result).toBe('ok');
    expect(waits).toEqual([1_000, 2_000]);
  });

  it('gives up after the attempts, or at once on a real refusal', async () => {
    const fn = vi.fn(async () => {
      throw offline();
    });
    await expect(withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 1, ...noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);

    const refused = vi.fn(async () => {
      throw conflict();
    });
    await expect(
      withRetry(refused, { attempts: 3, baseMs: 1, maxMs: 1, ...noWait }),
    ).rejects.toThrow();
    expect(refused).toHaveBeenCalledOnce();
  });

  it('stops when the caller is no longer interested', async () => {
    let alive = true;
    const fn = vi.fn(async () => {
      alive = false;
      throw offline();
    });
    await expect(
      withRetry(fn, { attempts: 5, baseMs: 1, maxMs: 1, alive: () => alive, ...noWait }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledOnce();
  });
});

const ride = (status: string) => ({ id: 'R1', status });

describe('acceptOffer', () => {
  it('returns the ride on the first answer', async () => {
    const accept = vi.fn(async () => ride('driver_assigned'));
    const currentRide = vi.fn(async () => null);
    await expect(
      acceptOffer({ accept, currentRide, rideId: 'r1', retry: noWait }),
    ).resolves.toEqual(ride('driver_assigned'));
    expect(currentRide).not.toHaveBeenCalled();
  });

  it('a retry refused because the first accept went through counts as accepted', async () => {
    const accept = vi
      .fn<() => Promise<{ id: string; status: string }>>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(conflict('Taklif endi amal qilmaydi'));
    const currentRide = vi.fn(async () => ride('driver_assigned'));
    await expect(
      acceptOffer({ accept, currentRide, rideId: 'R1', retry: noWait }),
    ).resolves.toEqual(ride('driver_assigned'));
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('taken by another driver stays a failure', async () => {
    const error = conflict('Buyurtma boshqa haydovchiga berildi');
    const accept = vi.fn(async () => {
      throw error;
    });
    const currentRide = vi.fn(async () => null);
    await expect(acceptOffer({ accept, currentRide, rideId: 'R1', retry: noWait })).rejects.toBe(
      error,
    );
  });

  it('another ride in hand is not this offer', async () => {
    const accept = vi.fn(async () => {
      throw conflict();
    });
    const currentRide = vi.fn(async () => ({ id: 'R2', status: 'driver_assigned' }));
    await expect(
      acceptOffer({ accept, currentRide, rideId: 'R1', retry: noWait }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('runRideStep', () => {
  it('a 409 after a lost answer is success when the ride already moved on', async () => {
    const send = vi
      .fn<() => Promise<{ id: string; status: string }>>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(conflict());
    const fetchRide = vi.fn(async () => ride('driver_arrived'));
    await expect(
      runRideStep({ send, fetchRide, action: 'arrive', retry: noWait }),
    ).resolves.toEqual(ride('driver_arrived'));
  });

  it('a 409 for a ride that did not move is shown', async () => {
    const send = vi.fn(async () => {
      throw conflict('Buyurtma holati mos emas: cancelled');
    });
    const fetchRide = vi.fn(async () => ride('cancelled'));
    await expect(
      runRideStep({ send, fetchRide, action: 'complete', retry: noWait }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('other errors are not second-guessed', async () => {
    const send = vi.fn(async () => {
      throw new ApiError(403, 'no');
    });
    const fetchRide = vi.fn(async () => ride('driver_arrived'));
    await expect(runRideStep({ send, fetchRide, action: 'arrive', retry: noWait })).rejects.toThrow(
      'no',
    );
    expect(fetchRide).not.toHaveBeenCalled();
  });
});
