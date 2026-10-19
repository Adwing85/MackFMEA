import { useState } from "react";
import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader } from "../components/ui";
import { ACTION_LABELS, fmtDateTime } from "../format";
import { useDebounced, useResource } from "../hooks";
import type { AuditEntry } from "../types";

const PAGE = 50;
const ENTITY_LABELS: Record<string, string> = {
  assembly: "Baugruppe",
  component: "Bauteil",
  fmea: "FMEA",
  user: "Benutzer",
  requirement: "Anforderungsregel",
  measure: "Maßnahme",
  key: "Schlüssel",
  key_table: "Schlüsseltabelle",
  attribute: "Merkmal",
  attribute_option: "Ausprägung",
  standard: "Werknorm",
  sc_class: "SC-Klasse",
  catalog: "Regelwerk",
};

export function AuditPage() {
  const { hasRole } = useAuth();
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(query);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (action) params.set("action", action);
  if (entity) params.set("entity_type", entity);
  if (q) params.set("q", q);
  const { data, error, loading } = useResource<{ total: number; items: AuditEntry[] }>(hasRole("pruefer", "admin") ? `/api/audit?${params}` : null);
  const [verify, setVerify] = useState<{ valid: boolean; checked: number; first_invalid_id: number | null } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  if (!hasRole("pruefer", "admin")) return <Notice kind="warning">Das Auditlog ist für Prüfer und Admins sichtbar.</Notice>;

  const runVerify = async () => {
    try {
      setVerify(await api.get("/api/audit/verify"));
      setVerifyError(null);
    } catch (err) {
      setVerifyError(errorText(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Auditlog"
        subtitle="Lückenlose Protokollierung aller Klassifikationsentscheidungen, Regelwerksänderungen und generierten FMEAs. Einträge sind per SHA-256 verkettet."
        actions={<Button onClick={runVerify}>Integrität prüfen</Button>}
      />
      <ErrorBox error={error ?? verifyError} />
      {verify &&
        (verify.valid ? (
          <Notice kind="success">Hash-Kette intakt – {verify.checked} Einträge geprüft.</Notice>
        ) : (
          <Notice kind="warning">Hash-Kette unterbrochen ab Eintrag #{verify.first_invalid_id} – mögliche Manipulation!</Notice>
        ))}
      <Card
        title={data ? `${data.total} Einträge` : "Einträge"}
        actions={
          <div className="filters">
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Alle Aktionen</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Alle Objekte</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Text suchen …"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
          </div>
        }
        flush
      >
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>Keine Einträge.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zeitpunkt</th>
                  <th>Benutzer</th>
                  <th>Aktion</th>
                  <th>Objekt</th>
                  <th>Beschreibung</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="muted">{a.id}</td>
                    <td className="nowrap small">{fmtDateTime(a.timestamp)}</td>
                    <td>{a.username}</td>
                    <td className="nowrap">{ACTION_LABELS[a.action] ?? a.action}</td>
                    <td className="nowrap small">
                      {ENTITY_LABELS[a.entity_type] ?? a.entity_type} {a.entity_id && <span className="muted">#{a.entity_id}</span>}
                    </td>
                    <td>
                      {a.summary}
                      {Object.keys(a.details ?? {}).length > 0 && (
                        <details className="json">
                          <summary>Details</summary>
                          <pre>{JSON.stringify(a.details, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                    <td className="hash" title={a.hash}>
                      {a.hash.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="row" style={{ padding: 12, justifyContent: "flex-end" }}>
            <span className="muted small">
              {offset + 1}–{Math.min(offset + PAGE, data.total)} von {data.total}
            </span>
            <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Zurück
            </Button>
            <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
              Weiter
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
