/**
 * Whether the API answered the last request: the offline banner reads this. Any answer
 * (even an error status) means online; a request that got no answer means offline.
 * Framework-free so it is unit-tested in plain Node.
 */

let online = true;
const listeners = new Set<() => void>();

export function setOnline(value: boolean): void {
  if (value === online) return;
  online = value;
  for (const l of listeners) l();
}

export function isOnline(): boolean {
  return online;
}

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
