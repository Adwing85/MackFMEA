/**
 * Persistenz der Browser-Version.
 *
 * Der Datenbestand liegt im Speicher (`Store`) und wird als JSON-Dokumente gespeichert:
 *   catalog/<tabelle>           Regelwerk und Benutzer (je Tabelle ein Dokument)
 *   assemblies/<id>             Baugruppe
 *   components/<id>             Bauteil inkl. Klassifikationsversionen
 *   fmea/<id>                   FMEA-Kopfdaten
 *   fmea_parts/<id>-r<n> / -q<n> FMEA-Zeilen bzw. Anforderungen in Teilstücken (Dokumentgröße)
 *   audit/<sitzung>-<seite>     Auditlog seitenweise je Sitzung (keine Schreibkonflikte)
 *
 * Backends: die gemeinsame Datenbank der veröffentlichten Seite (`claude.use("db")`) oder – als lokale
 * Datei geöffnet – der Browser-Speicher. Nach jeder Änderung werden nur geänderte Dokumente geschrieben;
 * Änderungen anderer Nutzer kommen über Abonnements herein und lösen `mackfmea:data` aus.
 */

import { clone, stableStringify, type AuditRec, type FmeaRec, type Json, type Store } from "./model";
import seedData from "./seed.json";

type Docs = Map<string, Json>;

const CATALOG_TABLES = ["users", "sc_classes", "attributes", "standards", "requirements", "measures", "keys"] as const;
const COLLECTIONS = ["catalog", "assemblies", "components", "fmea", "fmea_parts", "audit"];
const ROWS_PER_PART = 30;
const REQS_PER_PART = 150;
export const AUDIT_PAGE_SIZE = 100;

export const SESSION = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------- Store <-> Dokumente

export function toDocs(store: Store): Docs {
  const docs: Docs = new Map();
  for (const table of CATALOG_TABLES) docs.set(`catalog/${table}`, { items: store[table] as unknown[] });
  docs.set("catalog/pdm", { items: store.pdm.items });
  for (const a of store.assemblies) docs.set(`assemblies/${a.id}`, a as unknown as Json);
  for (const c of store.components) docs.set(`components/${c.id}`, c as unknown as Json);
  for (const f of store.fmeas) {
    const { rows, requirements, ...header } = f;
    const rowParts = Math.ceil(rows.length / ROWS_PER_PART);
    const reqParts = Math.ceil(requirements.length / REQS_PER_PART);
    docs.set(`fmea/${f.id}`, { ...header, row_parts: rowParts, req_parts: reqParts });
    for (let i = 0; i < rowParts; i++)
      docs.set(`fmea_parts/${f.id}-r${i}`, { fmea_id: f.id, kind: "rows", index: i, items: rows.slice(i * ROWS_PER_PART, (i + 1) * ROWS_PER_PART) });
    for (let i = 0; i < reqParts; i++)
      docs.set(`fmea_parts/${f.id}-q${i}`, {
        fmea_id: f.id,
        kind: "requirements",
        index: i,
        items: requirements.slice(i * REQS_PER_PART, (i + 1) * REQS_PER_PART),
      });
  }
  const pages = new Map<string, AuditRec[]>();
  for (const e of store.audit) {
    const key = `${e.session}-${e.page}`;
    pages.set(key, [...(pages.get(key) ?? []), e]);
  }
  for (const [key, entries] of pages) docs.set(`audit/${key}`, { entries });
  return docs;
}

export function fromDocs(docs: Docs): Store {
  const items = <T,>(path: string): T[] => clone(((docs.get(path)?.items as T[] | undefined) ?? []) as T[]);
  const store: Store = {
    users: items("catalog/users"),
    sc_classes: items("catalog/sc_classes"),
    attributes: items("catalog/attributes"),
    standards: items("catalog/standards"),
    requirements: items("catalog/requirements"),
    measures: items("catalog/measures"),
    keys: items("catalog/keys"),
    assemblies: [],
    components: [],
    fmeas: [],
    audit: [],
    pdm: { items: items("catalog/pdm") },
  };
  const parts = new Map<number, { rows: [number, unknown[]][]; reqs: [number, unknown[]][] }>();
  for (const [path, body] of docs) {
    const [collection] = path.split("/");
    if (collection === "assemblies") store.assemblies.push(clone(body) as never);
    else if (collection === "components") store.components.push(clone(body) as never);
    else if (collection === "audit") store.audit.push(...clone((body.entries as AuditRec[]) ?? []));
    else if (collection === "fmea_parts") {
      const id = body.fmea_id as number;
      const entry = parts.get(id) ?? { rows: [], reqs: [] };
      (body.kind === "rows" ? entry.rows : entry.reqs).push([body.index as number, clone(body.items as unknown[])]);
      parts.set(id, entry);
    }
  }
  for (const [path, body] of docs) {
    if (!path.startsWith("fmea/")) continue;
    const header = clone(body) as Json;
    const p = parts.get(header.id as number) ?? { rows: [], reqs: [] };
    const rowParts = (header.row_parts as number) ?? 0;
    const reqParts = (header.req_parts as number) ?? 0;
    delete header.row_parts;
    delete header.req_parts;
    const join = (list: [number, unknown[]][], count: number) =>
      list.filter(([i]) => i < count).sort((a, b) => a[0] - b[0]).flatMap(([, rows]) => rows);
    store.fmeas.push({ ...(header as unknown as FmeaRec), rows: join(p.rows, rowParts) as never, requirements: join(p.reqs, reqParts) as never });
  }
  store.assemblies.sort((a, b) => a.id - b.id);
  store.components.sort((a, b) => a.id - b.id);
  store.fmeas.sort((a, b) => a.id - b.id);
  store.audit.sort((a, b) => a.id - b.id);
  return store;
}

export function seedStore(): Store {
  const s = clone(seedData) as unknown as Store & { pdm: { items: Store["pdm"]["items"] } };
  return { ...s, fmeas: [], audit: [], pdm: { items: s.pdm.items } };
}

// ---------------------------------------------------------------- Backends

interface DbError {
  code: string;
  message: string;
}

interface Backend {
  kind: "shared" | "local";
  load(onRemote: (changes: Map<string, Json | null>) => void, onFatal: (e: DbError) => void): Promise<Docs>;
  write(path: string, body: Json | null): Promise<void>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ClaudeDb = any;

class SharedBackend implements Backend {
  kind = "shared" as const;
  constructor(private db: ClaudeDb) {}

  load(onRemote: (changes: Map<string, Json | null>) => void, onFatal: (e: DbError) => void): Promise<Docs> {
    return new Promise((resolve, reject) => {
      const docs: Docs = new Map();
      const ready = new Set<string>();
      let resolved = false;
      for (const collection of COLLECTIONS) {
        this.db
          .collection(collection)
          .limit(1000)
          .onSnapshot(
            (snap: { docChanges(): { type: string; doc: { id: string; data(): Json } }[] }) => {
              const changes = new Map<string, Json | null>();
              for (const ch of snap.docChanges()) {
                changes.set(`${collection}/${ch.doc.id}`, ch.type === "removed" ? null : (ch.doc.data() as Json));
              }
              if (!resolved) {
                for (const [path, body] of changes) {
                  if (body) docs.set(path, body);
                  else docs.delete(path);
                }
                ready.add(collection);
                if (ready.size === COLLECTIONS.length) {
                  resolved = true;
                  resolve(docs);
                }
              } else if (changes.size) {
                onRemote(changes);
              }
            },
            (err: DbError) => {
              if (!resolved) reject(err);
              else onFatal(err);
            },
          );
      }
    });
  }

  async write(path: string, body: Json | null): Promise<void> {
    const ref = this.db.doc(path);
    try {
      await (body ? ref.set(body) : ref.delete());
    } catch (err) {
      if ((err as DbError)?.code === "unavailable") {
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
        await (body ? ref.set(body) : ref.delete());
      } else {
        throw err;
      }
    }
  }
}

const LOCAL_KEY = "mackfmea.standalone.docs.v1";

class LocalBackend implements Backend {
  kind = "local" as const;
  private docs: Record<string, Json> = {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async load(onRemote: (changes: Map<string, Json | null>) => void): Promise<Docs> {
    try {
      this.docs = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    } catch {
      this.docs = {};
    }
    // Änderungen aus anderen Tabs desselben Browsers übernehmen
    window.addEventListener("storage", (e) => {
      if (e.key !== LOCAL_KEY || !e.newValue) return;
      let next: Record<string, Json> = {};
      try {
        next = JSON.parse(e.newValue);
      } catch {
        return;
      }
      const changes = new Map<string, Json | null>();
      for (const [path, body] of Object.entries(next)) changes.set(path, body);
      for (const path of Object.keys(this.docs)) if (!(path in next)) changes.set(path, null);
      this.docs = next;
      onRemote(changes);
    });
    return new Map(Object.entries(this.docs));
  }

  async write(path: string, body: Json | null): Promise<void> {
    if (body) this.docs[path] = body;
    else delete this.docs[path];
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(this.docs));
      } catch {
        notify({ storageError: "Der Browser-Speicher ist voll oder gesperrt – Änderungen werden nicht dauerhaft gespeichert." });
      }
    }, 50);
  }
}

// ---------------------------------------------------------------- Status für die Oberfläche

export interface PersistenceStatus {
  mode: "shared" | "local" | null;
  readOnly: boolean;
  storageError: string | null;
}

export const status: PersistenceStatus = { mode: null, readOnly: false, storageError: null };

function notify(patch: Partial<PersistenceStatus>) {
  Object.assign(status, patch);
  window.dispatchEvent(new Event("mackfmea:status"));
}

// ---------------------------------------------------------------- Abgleich

class Persistence {
  store: Store = seedStore();
  private backend: Backend | null = null;
  private docs: Docs = new Map();
  private json = new Map<string, string>();
  private confirmed = new Map<string, Json>();
  private inFlight = new Map<string, Promise<void>>();
  private pending = new Map<string, Json | null>();
  canWrite: boolean | null = null;

  async init(): Promise<{ empty: boolean }> {
    this.backend = await pickBackend();
    if (this.backend.kind === "shared") this.canWrite = await detectWrite();
    notify({ mode: this.backend.kind, readOnly: this.canWrite === false });
    const docs = await this.backend.load(
      (changes) => this.applyRemote(changes),
      () => notify({ storageError: "Die Verbindung zur gemeinsamen Datenbank wurde beendet. Bitte Seite neu laden." }),
    );
    this.setDocs(docs);
    this.confirmed = new Map([...docs].map(([p, b]) => [p, clone(b)]));
    const empty = !docs.has("catalog/sc_classes");
    if (!empty) this.store = fromDocs(docs);
    return { empty };
  }

  get mode() {
    return this.backend?.kind ?? null;
  }

  /** Musterregelwerk und Demodaten laden; `record` schreibt den Audit-Eintrag vor dem Speichern. */
  seed(record?: () => void) {
    this.store = seedStore();
    record?.();
    this.commit();
  }

  private setDocs(docs: Docs) {
    this.docs = docs;
    this.json = new Map([...docs].map(([p, b]) => [p, stableStringify(b)]));
  }

  /** Schreibt alle seit dem letzten Abgleich geänderten Dokumente. */
  commit() {
    if (!this.backend || status.readOnly) return;
    const next = toDocs(this.store);
    for (const [path, body] of next) {
      const text = stableStringify(body);
      if (this.json.get(path) === text) continue;
      this.json.set(path, text);
      this.docs.set(path, body);
      this.enqueue(path, clone(body));
    }
    for (const path of [...this.docs.keys()]) {
      if (next.has(path)) continue;
      this.docs.delete(path);
      this.json.delete(path);
      this.enqueue(path, null);
    }
  }

  /** Höchstens ein Schreibvorgang je Dokument gleichzeitig; der jeweils neueste Stand gewinnt. */
  private enqueue(path: string, body: Json | null) {
    if (this.inFlight.has(path)) {
      this.pending.set(path, body);
      return;
    }
    const run = async (value: Json | null) => {
      try {
        await this.backend!.write(path, value);
        if (value) this.confirmed.set(path, value);
        else this.confirmed.delete(path);
      } catch (err) {
        this.handleWriteError(err as DbError);
      }
      if (this.pending.has(path)) {
        const nextValue = this.pending.get(path)!;
        this.pending.delete(path);
        await run(nextValue);
      }
    };
    const promise = run(body).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, promise);
  }

  private handleWriteError(err: DbError) {
    if (err?.code === "invalid_argument" || err?.code === "not_granted") {
      if (!status.readOnly) {
        notify({ readOnly: true });
        // Auf den bestätigten Stand der Datenbank zurücksetzen
        this.setDocs(new Map([...this.confirmed].map(([p, b]) => [p, clone(b)])));
        this.store = fromDocs(this.docs);
        window.dispatchEvent(new Event("mackfmea:data"));
      }
    } else if (err?.code === "quota_exceeded") {
      notify({ storageError: "Der Speicher dieser Seite ist voll. Bitte alte FMEA-Entwürfe oder Baugruppen löschen." });
    } else {
      notify({ storageError: `Speichern fehlgeschlagen (${err?.code ?? "unbekannt"}). Bitte Seite neu laden.` });
    }
  }

  private applyRemote(changes: Map<string, Json | null>) {
    let changed = false;
    for (const [path, body] of changes) {
      if (body) this.confirmed.set(path, clone(body));
      else this.confirmed.delete(path);
      if (this.inFlight.has(path)) continue; // eigener Schreibvorgang läuft – dessen Stand gilt
      if (body === null) {
        if (this.docs.delete(path)) changed = true;
        this.json.delete(path);
        continue;
      }
      const text = stableStringify(body);
      if (this.json.get(path) === text) continue;
      this.docs.set(path, clone(body));
      this.json.set(path, text);
      changed = true;
    }
    if (changed) {
      this.store = fromDocs(this.docs);
      window.dispatchEvent(new Event("mackfmea:data"));
    }
  }
}

async function pickBackend(): Promise<Backend> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    try {
      const db = await claude.use("db");
      if (db) return new SharedBackend(db);
    } catch {
      /* Fallback: lokal */
    }
  }
  return new LocalBackend();
}

async function detectWrite(): Promise<boolean | null> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<any> } }).claude;
  try {
    const user = await claude?.use("user");
    if (!user?.can) return null;
    const result = await user.can("data.write");
    return result === null || result === undefined ? null : Boolean(result);
  } catch {
    return null;
  }
}

export const persistence = new Persistence();
