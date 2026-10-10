import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, getRefreshToken, loadTokens, post, saveTokens, setSignedOutHandler } from './api';
import { useI18n } from './i18n';
import type { Store, User } from './types';

type Status = 'loading' | 'signedOut' | 'ready' | 'offline';

interface Session {
  status: Status;
  user: User | null;
  /** null until the shop is set up (onboarding). */
  store: Store | null;
  signIn: (data: { accessToken: string; refreshToken: string; user: User; store: Store | null }) => Promise<void>;
  signOut: () => Promise<void>;
  setStore: (store: Store) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [store, setStoreState] = useState<Store | null>(null);

  const setStore = useCallback(
    (s: Store) => {
      setStoreState(s);
      setLang(s.language);
    },
    [setLang],
  );

  const clear = useCallback(() => {
    setUser(null);
    setStoreState(null);
    setStatus('signedOut');
  }, []);

  const reload = useCallback(async () => {
    if (!(await loadTokens())) return clear();
    try {
      const me = await get<{ user: User; store: Store | null }>('/auth/me');
      setUser(me.user);
      if (me.store) setStore(me.store);
      else setStoreState(null);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await saveTokens(null, null);
        clear();
      } else {
        // Keep the saved login; the user can retry when the network is back.
        setStatus('offline');
      }
    }
  }, [clear, setStore]);

  useEffect(() => {
    setSignedOutHandler(clear);
    // Read the saved login from secure storage, then check it with the server.
    void loadTokens().then(() => reload());
    return () => setSignedOutHandler(null);
  }, [clear, reload]);

  const signIn = useCallback<Session['signIn']>(
    async (data) => {
      await saveTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      if (data.store) setStore(data.store);
      else setStoreState(null);
      setStatus('ready');
    },
    [setStore],
  );

  const signOut = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await post('/auth/logout', { refreshToken });
    } catch {
      // Offline or already expired: the local tokens are removed anyway.
    }
    await saveTokens(null, null);
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ status, user, store, signIn, signOut, setStore, reload }),
    [status, user, store, signIn, signOut, setStore, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
