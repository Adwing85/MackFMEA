import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../../api";
import { ACTION_LABELS, fmtDateTime, SCOPE_LABELS, STATUS_LABELS } from "../../format";
import { useResource } from "../../hooks";
import type { AuditEntry, FmeaDetail, FmeaRow, FmeaSummary } from "../../types";
import { ApBadge, Button, Card, Empty, ErrorBox, Loading, ScBadge } from "../ui";

export function RequirementsTab({ doc }: { doc: FmeaDetail }) {
  const [scope, setScope] = useState("");
  const byComponent = new Map<string, FmeaDetail["requirements"]>();
  doc.requirements
    .filter((r) => !scope || r.scope === scope)
    .forEach((r) => byComponent.set(r.component_label, [...(byComponent.get(r.component_label) ?? []), r]));

  return (
    <Card
      title="Abgeleitete Anforderungen an Halbzeug und Bauteil"
      actions={
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 160 }}>
          <option value="">Halbzeug + Bauteil</option>
          <option value="halbzeug">nur Halbzeug</option>
          <option value="bauteil">nur Bauteil</option>
        </select>
      }
    >
      {byComponent.size === 0 && <Empty>Keine Anforderungen.</Empty>}
      {[...byComponent.entries()].map(([label, reqs]) => (
        <div key={label} style={{ marginBottom: 20 }}>
          <div className="list-title">
            {label} <ScBadge level={reqs[0].sc_level} /> <span className="pill">{reqs.length} Anforderungen</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Bereich</th>
                <th style={{ width: 170 }}>Kategorie</th>
                <th style={{ width: 90 }}>Code</th>
                <th>Anforderung</th>
                <th style={{ width: 110 }}>Norm</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td>{SCOPE_LABELS[r.scope]}</td>
                  <td>{r.category}</td>
                  <td className="mono">{r.requirement_code}</td>
                  <td>{r.text}</td>
                  <td className="small">{r.standard_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  );
}

export function TraceabilityTab({ doc }: { doc: FmeaDetail }) {
  const snap = doc.snapshot;
  return (
    <div className="stack">
      <Card title="Generierungsprozess">
        <div className="process">
          {snap.process?.map((p) => (
            <div key={p.step} className="process-step">
              <div className="num">{p.step}</div>
              <div className="name">{p.name}</div>
              <div className="result">{p.result}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-2">
        <Card title="Generierung">
          <dl className="kv">
            <dt>Generiert am</dt>
            <dd>{fmtDateTime(snap.generated_at)}</dd>
            <dt>Generiert von</dt>
            <dd>{snap.generated_by}</dd>
            <dt>Generator-Version</dt>
            <dd>{snap.generator_version}</dd>
            <dt>Regelwerksstand</dt>
            <dd className="hash">{snap.ruleset_fingerprint}</dd>
            <dt>Inhalts-Hash</dt>
            <dd className="hash">{doc.content_hash}</dd>
            <dt>Quelle Stückliste</dt>
            <dd>
              {String(snap.assembly?.source ?? "")} {snap.assembly?.pdm_ref ? `(${snap.assembly.pdm_ref})` : ""}
            </dd>
          </dl>
        </Card>
        <Card title="Nicht berücksichtigte Positionen">
          {snap.skipped?.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {snap.skipped.map((s) => (
                <li key={s.component_id}>
                  {s.label} – <span className="muted">{s.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Alle Positionen wurden berücksichtigt.</Empty>
          )}
        </Card>
      </div>
      <Card title="Merkmalsübergabe und Schlüssel je Bauteil">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bauteil</th>
                <th>SC</th>
                <th>Klassifikation</th>
                <th>Schlüssel (Merkmal + SC-Klasse)</th>
                <th>Maßnahmen</th>
                <th>Anforderungen</th>
                <th>Zeilen</th>
              </tr>
            </thead>
            <tbody>
              {snap.components?.map((c) => (
                <tr key={c.component_id}>
                  <td>
                    <Link to={`/bauteile/${c.component_id}/klassifikation`}>{c.label}</Link>
                  </td>
                  <td>
                    <ScBadge level={c.sc_level} />
                  </td>
                  <td>v{c.classification_version}</td>
                  <td>
                    {c.keys.map((k) => (
                      <span key={k} className="tag mono">
                        {k}
                      </span>
                    ))}
                  </td>
                  <td className="small" title={c.measures.join(", ")}>
                    {c.measures.length}
                  </td>
                  <td className="small" title={c.requirements.join(", ")}>
                    {c.requirements.length}
                  </td>
                  <td>{c.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function HistoryTab({ fmeaId }: { fmeaId: number }) {
  const { data, error, loading } = useResource<AuditEntry[]>(`/api/fmea/${fmeaId}/history`);
  if (loading && !data) return <Loading />;
  return (
    <Card title="Änderungshistorie (Auditlog)">
      <ErrorBox error={error} />
      {!data || data.length === 0 ? (
        <Empty>Keine Einträge.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Zeitpunkt</th>
              <th>Aktion</th>
              <th>Benutzer</th>
              <th>Beschreibung</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{fmtDateTime(a.timestamp)}</td>
                <td className="nowrap">{ACTION_LABELS[a.action] ?? a.action}</td>
                <td>{a.username}</td>
                <td>
                  {a.summary}
                  {Object.keys(a.details ?? {}).length > 0 && (
                    <details className="json">
                      <summary>Details</summary>
                      <pre>{JSON.stringify(a.details, null, 2)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

interface CompareResult {
  base: { id: number; version: number };
  current: { id: number; version: number };
  rows_added: FmeaRow[];
  rows_removed: FmeaRow[];
  rows_changed: { focus_element: string; failure_mode: string; lower_level: string; changes: Record<string, { alt: unknown; neu: unknown }> }[];
  requirements_added: string[];
  requirements_removed: string[];
  fingerprint_changed: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  severity: "B",
  occurrence: "A",
  detection: "E",
  action_priority: "AP",
  prevention_controls: "Vermeidung",
  detection_controls: "Entdeckung",
  failure_cause: "Ursache",
  failure_effect: "Folge",
  special_characteristic: "Bes. Merkmal",
};

export function CompareTab({ doc }: { doc: FmeaDetail }) {
  const versions = useResource<FmeaSummary[]>(`/api/fmea?assembly_id=${doc.assembly_id}`);
  const others = (versions.data ?? []).filter((v) => v.id !== doc.id);
  const [baseId, setBaseId] = useState<number | "">("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compare = async () => {
    if (!baseId) return;
    try {
      setResult(await api.get<CompareResult>(`/api/fmea/${doc.id}/compare/${baseId}`));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card
      title="Versionsvergleich"
      actions={
        <>
          <select value={baseId} onChange={(e) => setBaseId(e.target.value ? Number(e.target.value) : "")} style={{ width: 240 }}>
            <option value="">Vergleichsversion wählen …</option>
            {others.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.version} – {STATUS_LABELS[v.status]} ({fmtDateTime(v.created_at)})
              </option>
            ))}
          </select>
          <Button onClick={compare} disabled={!baseId}>
            Vergleichen
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      {others.length === 0 && <Empty>Es gibt keine weitere Version dieser Baugruppe.</Empty>}
      {result && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            V{result.current.version} gegenüber V{result.base.version}:{" "}
            <strong>{result.rows_added.length}</strong> neue, <strong>{result.rows_removed.length}</strong> entfallene und{" "}
            <strong>{result.rows_changed.length}</strong> geänderte Zeilen; Anforderungen +{result.requirements_added.length} / −
            {result.requirements_removed.length}.{" "}
            {result.fingerprint_changed ? "Das Regelwerk hat sich zwischen den Versionen geändert." : "Gleicher Regelwerksstand."}
          </p>
          {result.rows_changed.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Element / Fehlerart</th>
                  <th>Merkmal</th>
                  <th>Änderungen</th>
                </tr>
              </thead>
              <tbody>
                {result.rows_changed.map((c, i) => (
                  <tr key={i}>
                    <td>
                      {c.focus_element}
                      <div className="muted small">{c.failure_mode}</div>
                    </td>
                    <td className="small">{c.lower_level}</td>
                    <td className="small">
                      {Object.entries(c.changes).map(([field, change]) => (
                        <div key={field}>
                          <strong>{FIELD_LABELS[field] ?? field}:</strong>{" "}
                          {field === "action_priority" ? (
                            <>
                              <ApBadge ap={String(change.alt)} /> → <ApBadge ap={String(change.neu)} />
                            </>
                          ) : String(change.alt).length > 40 ? (
                            <span className="muted">Text geändert</span>
                          ) : (
                            <>
                              <span className="diff-old">{String(change.alt)}</span> → <span className="diff-new">{String(change.neu)}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(result.rows_added.length > 0 || result.rows_removed.length > 0) && (
            <div className="grid grid-2">
              <div>
                <div className="list-title">Neue Zeilen</div>
                {result.rows_added.map((r) => (
                  <div key={r.id} className="small">
                    <span className="diff-new">+</span> {r.focus_element} · {r.failure_mode} · {r.lower_level}
                  </div>
                ))}
              </div>
              <div>
                <div className="list-title">Entfallene Zeilen</div>
                {result.rows_removed.map((r) => (
                  <div key={r.id} className="small">
                    <span className="diff-old">−</span> {r.focus_element} · {r.failure_mode} · {r.lower_level}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(result.requirements_added.length > 0 || result.requirements_removed.length > 0) && (
            <div className="grid grid-2">
              <div>
                <div className="list-title">Neue Anforderungen</div>
                {result.requirements_added.map((r) => (
                  <div key={r} className="small">
                    <span className="diff-new">+</span> {r}
                  </div>
                ))}
              </div>
              <div>
                <div className="list-title">Entfallene Anforderungen</div>
                {result.requirements_removed.map((r) => (
                  <div key={r} className="small">
                    <span className="diff-old">−</span> {r}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
