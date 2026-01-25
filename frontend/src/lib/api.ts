export const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await safeMessage(res);
    throw new Error(message);
  }
  return (await res.json()) as T;
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.message) return `${data.message} (${res.status})`;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}

export async function getJson<T>(path: string, init?: RequestInit & { cache?: RequestCache }): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { cache: "no-store", ...init });
  return handle<T>(res);
}
