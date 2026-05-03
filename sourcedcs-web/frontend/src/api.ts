export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = (() => { try { return localStorage.getItem('sdcs-token'); } catch { return null; } })();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options?.body instanceof FormData) && options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
