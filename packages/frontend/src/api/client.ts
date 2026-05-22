const API_BASE = "/api";

async function request<T>(url: string, options?: globalThis.RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function get<T>(url: string): Promise<T> {
  return request<T>(url);
}

export function post<T>(url: string, data: unknown): Promise<T> {
  return request<T>(url, { method: "POST", body: JSON.stringify(data) });
}

export function patch<T>(url: string, data: unknown): Promise<T> {
  return request<T>(url, { method: "PATCH", body: JSON.stringify(data) });
}

export function put<T>(url: string, data: unknown): Promise<T> {
  return request<T>(url, { method: "PUT", body: JSON.stringify(data) });
}

export function del<T>(url: string): Promise<T> {
  return request<T>(url, { method: "DELETE" });
}