const P = 'techno_surfers.';
export function load<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(P + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(P + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
