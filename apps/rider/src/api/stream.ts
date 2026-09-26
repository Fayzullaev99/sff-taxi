import EventSource from 'react-native-sse';

export interface StreamHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  /** The stream failed or ended; it is closed and will not reconnect by itself. */
  onDown: () => void;
}

/**
 * Opens one server-sent event stream. React Native has no EventSource, so this uses
 * react-native-sse (XHR based) with its own reconnects off: a ticket works only once.
 */
export function openStream(url: string, handlers: StreamHandlers): () => void {
  const es = new EventSource(url, { pollingInterval: 0, timeoutBeforeConnection: 0 });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    es.removeAllEventListeners();
    es.close();
  };
  es.addEventListener('open', () => handlers.onOpen());
  es.addEventListener('message', (event) => {
    if (event.data) handlers.onMessage(event.data);
  });
  const down = () => {
    if (closed) return;
    close();
    handlers.onDown();
  };
  es.addEventListener('error', down);
  es.addEventListener('close', down);
  return close;
}
