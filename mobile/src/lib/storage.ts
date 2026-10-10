import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Tokens live in the phone's secure storage (Keystore / Keychain). On web (testing only) localStorage is used.
const web = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  if (web) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string | null): Promise<void> {
  if (web) {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private mode or blocked storage: the session simply won't survive a reload.
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}
