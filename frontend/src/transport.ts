/** HTTP-Transport zum FastAPI-Backend (Standard-Build). Die Browser-Version ersetzt dieses Modul (Alias @transport). */
import { TransportError, type Transport } from "./transportError";

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

async function failure(response: Response): Promise<TransportError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* keine JSON-Antwort */
  }
  return new TransportError(response.status, parseDetail(payload));
}

export const transport: Transport = {
  async request<T>(method: string, path: string, body: unknown, isForm: boolean, token: string | null): Promise<T> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  },

  async download(path: string, fallbackName: string, token: string | null): Promise<void> {
    const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw await failure(response);
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
  },
};
