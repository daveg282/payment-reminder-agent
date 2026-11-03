import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

// ---------- refresh: bump after anything that changes data, every open view reloads ----------

const RefreshContext = createContext<{ version: number; refresh: () => void }>({ version: 0, refresh: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return <RefreshContext.Provider value={{ version, refresh }}>{children}</RefreshContext.Provider>;
}
export const useRefresh = () => useContext(RefreshContext);

// ---------- data loading ----------

export interface Loaded<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** Loads data on mount, when `deps` change, and on every app-wide refresh. Keeps old data while reloading. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const { version } = useRefresh();
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (err) => !cancelled && setState((s) => ({ data: s.data, loading: false, error: err instanceof ApiError ? err : new ApiError(0, String(err)) })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  return { ...state, data: state.data, reload: () => setTick((t) => t + 1) } as Loaded<T>;
}

// ---------- toasts ----------

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const show = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 6000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            <span>{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
