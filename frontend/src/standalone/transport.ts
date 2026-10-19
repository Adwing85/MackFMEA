/** Transport der Browser-Version: leitet API-Aufrufe an den eingebetteten Server statt per HTTP an FastAPI. */
import { TransportError, type Transport } from "../transportError";
import { decode } from "./bom";
import { persistence, status } from "./persistence";
import { HttpError, exportFile, handle } from "./server";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function toTransportError(err: unknown): unknown {
  if (err instanceof HttpError) return new TransportError(err.status, Array.isArray(err.detail) ? err.detail : [err.detail]);
  if (err instanceof Error) return new TransportError(500, [`Interner Fehler: ${err.message}`]);
  return err;
}

async function formToBody(form: FormData) {
  const fields: Record<string, string> = {};
  let file: { name: string; text: string } | null = null;
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
    else if (key === "file" && value.size) {
      if (value.size > MAX_UPLOAD_BYTES) throw new TransportError(413, ["Datei zu groß (max. 5 MB)"]);
      file = { name: value.name || "upload.csv", text: decode(await value.arrayBuffer()) };
    }
  }
  return { fields, file };
}

/** Datei an den Betrachter übergeben: in der veröffentlichten Seite über `downloads`, lokal per Link. */
async function saveFile(filename: string, blob: Blob) {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<any> } }).claude; // eslint-disable-line @typescript-eslint/no-explicit-any
  const downloads = claude?.use ? await claude.use("downloads").catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "declined") return;
      throw new TransportError(503, [`Download nicht möglich (${code ?? "unbekannt"}).`]);
    }
    return;
  }
  if (window.parent !== window && claude) throw new TransportError(503, ["Downloads sind in dieser Ansicht nicht verfügbar."]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const transport: Transport = {
  async request<T>(method: string, path: string, body: unknown, isForm: boolean, token: string | null): Promise<T> {
    const mutating = method !== "GET";
    if (mutating && status.readOnly && path !== "/api/auth/login")
      throw new TransportError(403, ["Nur-Lese-Zugriff: Ihre Freigabestufe für diese Seite erlaubt keine Änderungen."]);
    const payload = isForm ? await formToBody(body as FormData) : body;
    try {
      const result = handle(method, path, payload, token) as T;
      if (mutating) persistence.commit();
      return result;
    } catch (err) {
      if (path === "/api/auth/login") persistence.commit(); // fehlgeschlagene Anmeldung protokollieren
      throw toTransportError(err);
    }
  },

  async download(path: string, _fallbackName: string, token: string | null): Promise<void> {
    let file: { filename: string; blob: Blob };
    try {
      file = await exportFile(path, token);
      persistence.commit();
    } catch (err) {
      throw toTransportError(err);
    }
    await saveFile(file.filename, file.blob);
  },
};
