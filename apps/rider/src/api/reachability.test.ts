import { describe, expect, it, vi } from 'vitest';
import { isOnline, setOnline, subscribeOnline } from './reachability';

describe('reachability', () => {
  it('notifies only on changes', () => {
    const listener = vi.fn();
    const stop = subscribeOnline(listener);
    expect(isOnline()).toBe(true);
    setOnline(true);
    expect(listener).not.toHaveBeenCalled();
    setOnline(false);
    setOnline(false);
    expect(isOnline()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    setOnline(true);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setOnline(false);
    expect(listener).toHaveBeenCalledTimes(2);
    setOnline(true);
  });
});
