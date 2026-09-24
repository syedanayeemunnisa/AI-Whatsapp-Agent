/**
 * Typed fetch wrapper for the local backend (task §37 API).
 * - Attaches the JWT from localStorage
 * - On 401: clears the session and redirects to /login
 * - Base URL: '' in dev (Vite proxy), backend origin in production
 */

// Trim whitespace and trailing slashes: a stray space (e.g. pasted with the
// URL) or a trailing "/" makes every fetch() URL invalid → "Cannot reach the
// local server" errors that are impossible to debug from the UI.
const RAW_API_BASE: string = import.meta.env.VITE_API_BASE ?? '';
export const API_BASE: string = RAW_API_BASE.trim().replace(/\/+$/, '');

const TOKEN_KEY = 'awa_token';
const USER_KEY = 'awa_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): { id: number; name: string; email: string; role: string } | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 240000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    throw new ApiError(
      0,
      aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      aborted
        ? 'The local server took too long to respond.'
        : 'Cannot reach the local server. Is it running?'
    );
  }
  clearTimeout(timer);

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearSession();
    window.location.assign('/login');
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired. Please log in again.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const err = (isJson && (data as { error?: { code?: string; message?: string; details?: unknown } }).error) || {};
    throw new ApiError(res.status, err.code || 'HTTP_ERROR', err.message || `HTTP ${res.status}`, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>('POST', path, body, timeoutMs),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
