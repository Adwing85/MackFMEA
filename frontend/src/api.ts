const TOKEN_KEY = "mackfmea.token";

export class ApiError extends Error {
  status: number;
  details: string[];

  constructor(status: number, details: string[]) {
    super(details.join("\n"));
    this.status = status;
    this.details = details;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Speicher nicht verfügbar – Sitzung bleibt nur im Speicher */
  }
}

function parseDetail(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return ["Unbekannter Fehler"];
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return [detail];
  if (Array.isArray(detail)) {
    return detail.map((d) => {
      if (typeof d === "string") return d;
      if (d && typeof d === "object" && "msg" in d) {
        const loc = Array.isArray((d as { loc?: unknown[] }).loc) ? (d as { loc: unknown[] }).loc.slice(1).join(".") : "";
        return `${loc ? loc + ": " : ""}${(d as { msg: string }).msg}`;
      }
      return JSON.stringify(d);
    });
  }
  return ["Unbekannter Fehler"];
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (response.status === 401 && path !== "/api/auth/login") {
    setToken(null);
    window.dispatchEvent(new Event("mackfmea:logout"));
  }
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(response.status, parseDetail(payload));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form, true),
};

/** Lädt eine Datei mit Authentifizierung herunter und speichert sie im Browser. */
export async function download(path: string, fallbackName: string) {
  const token = getToken();
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(response.status, parseDetail(payload));
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.details.join("\n");
  if (error instanceof Error) return error.message;
  return String(error);
}
