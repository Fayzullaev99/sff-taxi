import { describe, expect, it } from 'vitest';
import { type AppStateLike, isBackground, whenForeground } from './foreground';

function fakeAppState(initial: string) {
  const listeners = new Set<(s: string) => void>();
  const state: AppStateLike & { go(s: string): void; listeners: number } = {
    currentState: initial,
    addEventListener(_type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    go(s: string) {
      state.currentState = s;
      for (const l of [...listeners]) l(s);
    },
    get listeners() {
      return listeners.size;
    },
  };
  return state;
}

describe('whenForeground', () => {
  it('holds back only in the background', () => {
    expect(isBackground('background')).toBe(true);
    expect(isBackground('active')).toBe(false);
    expect(isBackground('inactive')).toBe(false);
    expect(isBackground(null)).toBe(false);
  });

  it('resolves at once in the foreground', async () => {
    await expect(whenForeground(fakeAppState('active'))).resolves.toBeUndefined();
  });

  it('waits for the app to come back and stops listening', async () => {
    const app = fakeAppState('background');
    let done = false;
    const waiting = whenForeground(app).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    app.go('background');
    await Promise.resolve();
    expect(done).toBe(false);
    app.go('active');
    await waiting;
    expect(done).toBe(true);
    expect(app.listeners).toBe(0);
  });
});
