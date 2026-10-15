import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sff-taxi.pending-invite';

/**
 * An invitation link opened before signing in (sfftaxi://invite/CODE): kept on the phone and
 * offered again right after the sign-in, so a new rider does not have to type the code.
 */
export const pendingInvite = {
  async get(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  async set(code: string | null): Promise<void> {
    try {
      if (code) await AsyncStorage.setItem(KEY, code);
      else await AsyncStorage.removeItem(KEY);
    } catch {
      // storage unavailable: the rider can still type the code in the profile
    }
  },
};
