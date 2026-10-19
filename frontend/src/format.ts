import type { FmeaStatus } from "./types";

export const STATUS_LABELS: Record<FmeaStatus, string> = {
  entwurf: "Entwurf",
  in_pruefung: "In Prüfung",
  freigegeben: "Freigegeben",
  abgelehnt: "Abgelehnt",
  ersetzt: "Ersetzt",
};

export const AP_LABELS = { H: "Hoch", M: "Mittel", L: "Niedrig" } as const;

export const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Anmeldung",
  LOGIN_FAILED: "Anmeldung fehlgeschlagen",
  CREATE: "Angelegt",
  UPDATE: "Geändert",
  DELETE: "Gelöscht",
  IMPORT: "Import",
  CLASSIFY: "Klassifikation",
  GENERATE: "Generierung",
  SUBMIT: "Eingereicht",
  APPROVE: "Freigabe",
  REJECT: "Zurückgewiesen",
  SUPERSEDE: "Ersetzt",
  EXPORT: "Export",
  PDM_STORE: "PDM-Rückspeicherung",
  PDM_SYNC: "PDM-Abgleich",
  SEED: "Initialisierung",
};

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "–";
  const iso = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  return dateTime.format(new Date(iso));
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "–";
  const iso = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  return dateOnly.format(new Date(iso));
}

export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export const SCOPE_LABELS = { halbzeug: "Halbzeug", bauteil: "Bauteil" } as const;

/** Bezeichnung ohne Beispiele in Klammern, z. B. „Vergütungsstahl (z. B. 42CrMo4)“ → „Vergütungsstahl“. */
export function shortLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "") || label;
}
