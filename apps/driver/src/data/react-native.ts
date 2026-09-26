import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

let installed = false;

/** Teaches React Query about React Native: connectivity and app focus. */
export function installReactQueryNativeBindings(): void {
  if (installed) return;
  installed = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) =>
      setFocused(status === 'active'),
    );
    return () => sub.remove();
  });
}
