/**
 * Waiting for the app to be in the foreground, framework-free (takes React Native's
 * AppState, or a fake in tests). Used to hold a token refresh back while the app is in the
 * background, where the OS may suspend the request halfway.
 */

export interface AppStateLike {
  currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/** Only `background` holds back: `inactive` (iOS dialogs) and `unknown` do not. */
export function isBackground(state: string | null | undefined): boolean {
  return state === 'background';
}

/** Resolves at once in the foreground, else when the app comes back to it. */
export function whenForeground(appState: AppStateLike): Promise<void> {
  if (!isBackground(appState.currentState)) return Promise.resolve();
  return new Promise((resolve) => {
    const sub = appState.addEventListener('change', (state) => {
      if (isBackground(state)) return;
      sub.remove();
      resolve();
    });
  });
}
