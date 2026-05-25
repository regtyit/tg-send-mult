const LS = 'tg_basic_auth';

export class ApiError extends Error {
  status: number;
  body: unknown;
  isNetwork: boolean;

  constructor(message: string, status: number, body: unknown, isNetwork = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.isNetwork = isNetwork;
  }
}

export function useBasicAuth() {
  const router = (() => {
    try {
      return useRouter();
    } catch {
      return null;
    }
  })();

  function saveAuth(user: string, password: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LS, btoa(`${user}:${password}`));
  }

  function clearAuth(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(LS);
  }

  function hasAuth(): boolean {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem(LS);
  }

  function authHeader(): string | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    return `Basic ${raw}`;
  }

  /**
   * Central JSON API helper:
   * - Always sends Basic auth (when stored).
   * - On 401, clears creds and redirects to /login (via Nuxt router; falls back
   *   to a hard redirect outside Nuxt context).
   * - On any non-2xx, throws an ApiError with `status`, `body`, and a parsed
   *   message from the server when available.
   * - On network errors, throws an ApiError with `isNetwork: true`.
   */
  async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const auth = authHeader();
    if (auth) headers.set('Authorization', auth);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let res: Response;
    try {
      res = await fetch(path, { ...init, headers });
    } catch (e) {
      throw new ApiError(
        e instanceof Error ? e.message : 'Network error',
        0,
        null,
        true,
      );
    }

    if (res.status === 401) {
      clearAuth();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        if (router) {
          await router.replace('/login');
        } else {
          window.location.href = '/login';
        }
      }
      throw new ApiError('Authentication required', 401, null);
    }

    if (!res.ok) {
      let body: unknown = null;
      let message = res.statusText || `HTTP ${res.status}`;
      const ct = res.headers.get('content-type');
      try {
        if (ct?.includes('application/json')) {
          body = await res.json();
          if (body && typeof body === 'object') {
            const obj = body as Record<string, unknown>;
            if (typeof obj.message === 'string' && obj.message.trim()) message = obj.message.trim();
            else if (typeof obj.error === 'string') message = obj.error;
          }
        } else {
          const txt = await res.text();
          body = txt;
          if (txt) message = txt;
        }
      } catch {
        // ignore body parsing failures
      }
      throw new ApiError(message, res.status, body);
    }

    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type');
    if (ct?.includes('application/json')) return (await res.json()) as T;
    return (await res.text()) as T;
  }

  return { saveAuth, clearAuth, hasAuth, apiFetch };
}

/** Alias for pages that call `useApi()` — same as `useBasicAuth()`. */
export function useApi() {
  return useBasicAuth();
}
