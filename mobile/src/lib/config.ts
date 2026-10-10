import { Platform } from 'react-native';

/**
 * Backend base URL. Set EXPO_PUBLIC_API_URL (e.g. https://api.example.com/api/v1) for real builds.
 * Without it, development uses the local backend: the Android emulator reaches the host computer at 10.0.2.2.
 * A real phone needs the computer's LAN address instead (EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api/v1).
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000/api/v1' : 'http://localhost:3000/api/v1');

/** Requests slower than this are aborted so the app never hangs on a bad network. */
export const REQUEST_TIMEOUT_MS = 15_000;
