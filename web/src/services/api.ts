/**
 * Live API: in dev, defaults to `/api` (Vite proxy → http://127.0.0.1:8765). Override with
 * `VITE_API_BASE_URL` (e.g. full URL for non-proxy setups). Set `VITE_USE_MOCK=true` for fixtures only.
 */
export function useMockDemo(): boolean {
  return import.meta.env.VITE_USE_MOCK === 'true';
}

export function getApiBase(): string | undefined {
  if (useMockDemo()) return undefined;

  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (raw === 'mock') return undefined;

  // Local dev: use Vite proxy so FastAPI works without a .env file
  if (import.meta.env.DEV && (raw === undefined || raw === '')) {
    return '/api';
  }

  if (!raw) return undefined;
  return raw.replace(/\/$/, '');
}

/** True when requests should hit the real FastAPI backend. */
export function hasLiveApi(): boolean {
  return Boolean(getApiBase()) && !useMockDemo();
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('fetchJson requires VITE_API_BASE_URL when not using mock demo');
  }
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('postJson requires VITE_API_BASE_URL');
  }
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
