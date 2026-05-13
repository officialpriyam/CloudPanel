export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type ApiError = {
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("cloudpanel.accessToken") : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers
    },
    cache: "no-store"
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({} as ApiError));
    throw new Error(payload.error?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  window.localStorage.setItem("cloudpanel.accessToken", tokens.accessToken);
  window.localStorage.setItem("cloudpanel.refreshToken", tokens.refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem("cloudpanel.accessToken");
  window.localStorage.removeItem("cloudpanel.refreshToken");
}
