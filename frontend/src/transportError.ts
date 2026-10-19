/** Fehler eines Transports (HTTP oder Browser-Version); api.ts wandelt ihn in ApiError um. */
export class TransportError extends Error {
  status: number;
  details: string[];

  constructor(status: number, details: string[]) {
    super(details.join("\n"));
    this.status = status;
    this.details = details;
  }
}

export interface Transport {
  request<T>(method: string, path: string, body: unknown, isForm: boolean, token: string | null): Promise<T>;
  download(path: string, fallbackName: string, token: string | null): Promise<void>;
}
