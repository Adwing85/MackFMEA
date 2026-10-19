import { transport } from "@transport";
import { TransportError } from "./transportError";

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

function translate(err: unknown, path: string): unknown {
  if (!(err instanceof TransportError)) return err;
  if (err.status === 401 && path !== "/api/auth/login") {
    setToken(null);
    window.dispatchEvent(new Event("mackfmea:logout"));
  }
  return new ApiError(err.status, err.details);
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  try {
    return await transport.request<T>(method, path, body, isForm, getToken());
  } catch (err) {
    throw translate(err, path);
  }
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
  try {
    await transport.download(path, fallbackName, getToken());
  } catch (err) {
    throw translate(err, path);
  }
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.details.join("\n");
  if (error instanceof Error) return error.message;
  return String(error);
}
