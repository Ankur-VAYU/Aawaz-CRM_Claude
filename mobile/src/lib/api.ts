import * as Crypto from 'expo-crypto';
import { API_URL, REQUEST_TIMEOUT_MS } from './config';
import { getItem, setItem } from './storage';

const ACCESS_KEY = 'aawaz.accessToken';
const REFRESH_KEY = 'aawaz.refreshToken';

/** An error response from the backend ({ error: { code, message } }) or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded = false;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

/** Called when the login can no longer be refreshed (expired, revoked or signed out elsewhere). */
export function setSignedOutHandler(fn: (() => void) | null) {
  onSignedOut = fn;
}

export async function loadTokens() {
  if (loaded) return refreshToken !== null;
  [accessToken, refreshToken] = await Promise.all([getItem(ACCESS_KEY), getItem(REFRESH_KEY)]);
  loaded = true;
  return refreshToken !== null;
}

export async function saveTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  loaded = true;
  await Promise.all([setItem(ACCESS_KEY, access), setItem(REFRESH_KEY, refresh)]);
}

export function getRefreshToken() {
  return refreshToken;
}

/** Idempotency key: the backend records a bill/payment with the same clientId only once, so retries are safe. */
export function newClientId() {
  return Crypto.randomUUID();
}

async function send(method: string, path: string, body: unknown, token: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    return await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

/**
 * Gets a new token pair. Only one refresh runs at a time: the backend treats a reused refresh token
 * as theft and ends the login, so parallel 401s must share the same refresh.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const current = refreshToken;
      if (!current) return false;
      const res = await send('POST', '/auth/refresh', { refreshToken: current }, null);
      if (res.status === 401) {
        await saveTokens(null, null);
        onSignedOut?.();
        return false;
      }
      const data = await parse<{ accessToken: string; refreshToken: string }>(res);
      await saveTokens(data.accessToken, data.refreshToken);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth ?? true;
  if (auth) await loadTokens();
  let res = await send(method, path, body, auth ? accessToken : null);
  if (res.status === 401 && auth && refreshToken) {
    if (await refreshOnce()) res = await send(method, path, body, accessToken);
  }
  return parse<T>(res);
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T>(path: string, body?: unknown) => api<T>('DELETE', path, body);

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
