export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore (non-JSON error bodies)
  }
  if (!r.ok) {
    const msg =
      data?.error ??
      (Array.isArray(data?.errors) && data.errors.length > 0
        ? `${r.status} ${r.statusText}: ${data.errors
            .map((e: any) => `${e?.name ?? 'unknown'}: ${e?.error ?? 'failed'}`)
            .join(', ')}`
        : `${r.status} ${r.statusText}`);
    throw new Error(msg);
  }
  return data as T;
}

