/**
 * Whether a sign-in page shows its logo and tagline small: when the room left above the
 * keyboard (or a landscape phone's whole height) is short, the form and its button come
 * first (a landscape tablet with the keypad up has ~400 dp).
 */
export function compactHero(windowHeight: number, keyboardHeight: number): boolean {
  return windowHeight - Math.max(0, keyboardHeight) < 560;
}
