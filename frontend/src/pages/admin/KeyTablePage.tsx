import { useMemo, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Notice, PageHeader, ScBadge } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { Attribute, KeyEntry, Measure } from "../../types";

const LEVELS = [0, 1, 2, 3, 4];

function KeyEditor({ entry, measures, isAdmin, onChanged }: { entry: KeyEntry; measures: Measure[]; isAdmin: boolean; onChanged: (k: KeyEntry) => void }) {
  const { busy, error, setError, run } = useAction();
  const [measureId, setMeasureId] = useState<number | "">("");
  const [extent, setExtent] = useState("");
  const [rating, setRating] = useState<number | "">("");
  const [propagate, setPropagate] = useState(true);
  const assigned = new Set(entry.measures.map((m) => m.measure_id));
  const available = measures.filter((m) => m.active && !assigned.has(m.id));

  const add = async () => {
    if (!measureId) return;
    const result = await run(() =>
      api.post<KeyEntry>(`/api/catalog/keys/${entry.id}/measures`, {
        measure_id: measureId,
        extent,
        rating: rating === "" ? null : rating,
        propagate_up: propagate,
      }),
    );
    if (result) {
      onChanged(result);
      setMeasureId("");
      setExtent("");
      setRating("");
    }
  };

  const remove = async (id: number) => {
    const result = await run(() => api.del<KeyEntry>(`/api/catalog/keys/${entry.id}/measures/${id}?propagate_up=${propagate}`));
    if (result) onChanged(result);
  };

  const updateExtent = async (id: number, value: string) => {
    const result = await run(() => api.put<KeyEntry>(`/api/catalog/keys/${entry.id}/measures/${id}`, { extent: value }));
    if (result) onChanged(result);
  };

  return (
    <Card
      title={
        <>
          <span className="mono">{entry.code}</span> <ScBadge level={entry.sc_level} />
        </>
      }
      actions={<span className="muted small">{entry.measures.length} Maßnahmen</span>}
    >
      <ErrorBox error={error} onClose={() => setError(null)} />
      <p className="muted" style={{ marginTop: 0 }}>
        {entry.description}
      </p>
      {entry.measures.length === 0 ? (
        <Empty>Diesem Schlüssel sind keine Maßnahmen zugeordnet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Maßnahme</th>
              <th>Umfang / Tiefe</th>
              <th className="center">Bew.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entry.measures.map((m) => (
              <tr key={m.measure_id}>
                <td>
                  <span className={`tag tag-${m.measure_type.toLowerCase()}`}>{m.measure_type}</span> <span className="mono small">{m.code}</span>
                  <div className="small">{m.title}</div>
                </td>
                <td style={{ minWidth: 160 }}>
                  {isAdmin ? (
                    <input defaultValue={m.extent} onBlur={(e) => e.target.value !== m.extent && updateExtent(m.measure_id, e.target.value)} />
                  ) : (
                    m.extent || "–"
                  )}
                </td>
                <td className="center" title={m.rating ? "abweichend vom Katalogwert" : "Katalogwert"}>
                  {m.measure_type === "V" ? "A" : "E"} {m.effective_rating}
                  {m.rating ? "*" : ""}
                </td>
                <td className="actions">
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => remove(m.measure_id)} disabled={busy} title="Zuordnung entfernen">
                      ✕
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isAdmin && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <Field label="Maßnahme zuordnen">
            <select value={measureId} onChange={(e) => setMeasureId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Maßnahme wählen …</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} – {m.title} ({m.measure_type === "V" ? "A" : "E"} {m.rating})
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Umfang / Tiefe">
              <input value={extent} onChange={(e) => setExtent(e.target.value)} placeholder="z. B. 100 %" />
            </Field>
            <Field label="Bewertung (optional)" hint="leer = Katalogwert">
              <input type="number" min={1} max={10} value={rating} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : "")} />
            </Field>
          </div>
          <div className="row">
            <label className="checkbox">
              <input type="checkbox" checked={propagate} onChange={(e) => setPropagate(e.target.checked)} /> auch für höhere SC-Klassen übernehmen bzw. entfernen
            </label>
            <span className="spacer" />
            <Button variant="primary" onClick={add} busy={busy} disabled={!measureId}>
              Zuordnen
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function KeyTablePage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const keys = useResource<KeyEntry[]>("/api/catalog/keys");
  const attributes = useResource<Attribute[]>("/api/catalog/attributes");
  const measures = useResource<Measure[]>("/api/catalog/measures");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attrFilter, setAttrFilter] = useState("");
  const regen = useAction();
  const [message, setMessage] = useState<string | null>(null);

  const index = useMemo(() => {
    const map = new Map<string, KeyEntry>();
    (keys.data ?? []).forEach((k) => map.set(`${k.option_id}:${k.sc_level}`, k));
    return map;
  }, [keys.data]);

  const selected = keys.data?.find((k) => k.id === selectedId) ?? null;

  const regenerate = async () => {
    const result = await regen.run(() => api.post<{ created: number }>("/api/catalog/keys/regenerate"));
    if (result) {
      setMessage(`${result.created} neue Schlüssel angelegt.`);
      await keys.reload();
    }
  };

  const replaceKey = (updated: KeyEntry) => {
    keys.setData((keys.data ?? []).map((k) => (k.id === updated.id ? updated : k)));
    // Bei „für höhere SC-Klassen übernehmen“ ändern sich mehrere Schlüssel → vollständig neu laden
    void keys.reload();
  };

  return (
    <>
      <PageHeader
        title="Schlüsseltabelle"
        subtitle="Jede Kombination aus Merkmalsausprägung und SC-Klasse ergibt einen generischen Code. Über den Schlüssel werden Maßnahmen aus dem Katalog zugeordnet – Umfang und Tiefe skalieren mit der SC-Klasse."
        actions={
          isAdmin && (
            <Button onClick={regenerate} busy={regen.busy}>
              Fehlende Schlüssel erzeugen
            </Button>
          )
        }
      />
      <ErrorBox error={keys.error ?? attributes.error ?? regen.error} />
      {message && <Notice kind="success">{message}</Notice>}
      {(keys.loading && !keys.data) || !attributes.data ? (
        <Loading />
      ) : (
        <div className="split">
          <Card
            title="Matrix: Anzahl zugeordneter Maßnahmen"
            actions={
              <select value={attrFilter} onChange={(e) => setAttrFilter(e.target.value)} style={{ width: 200 }}>
                <option value="">Alle Merkmale</option>
                {attributes.data.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
            }
            flush
          >
            <div className="table-wrap">
              <table className="table matrix">
                <thead>
                  <tr>
                    <th className="label">Merkmal / Ausprägung</th>
                    {LEVELS.map((l) => (
                      <th key={l}>
                        <ScBadge level={l} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attributes.data
                    .filter((a) => !attrFilter || a.code === attrFilter)
                    .flatMap((a) => [
                      <tr key={`h-${a.code}`}>
                        <td colSpan={6} className="label" style={{ background: "var(--surface-2)", fontWeight: 600 }}>
                          <span className="mono muted">{a.code}</span> {a.name} <span className="muted small">(Liste {a.list_no})</span>
                        </td>
                      </tr>,
                      ...a.options.map((o) => (
                        <tr key={o.id}>
                          <td className="label small">
                            <span className="mono muted">{o.code}</span> {o.label}
                          </td>
                          {LEVELS.map((l) => {
                            const k = index.get(`${o.id}:${l}`);
                            if (!k) return <td key={l} className="muted">–</td>;
                            return (
                              <td key={l}>
                                <button className={`matrix-cell${selectedId === k.id ? " selected" : ""}`} onClick={() => setSelectedId(k.id)} title={k.code}>
                                  <span className="count">{k.measures.length}</span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    ])}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="sticky-panel">
            {selected ? (
              <KeyEditor key={selected.id} entry={selected} measures={measures.data ?? []} isAdmin={isAdmin} onChanged={replaceKey} />
            ) : (
              <Card title="Schlüssel">
                <Empty>Zelle in der Matrix wählen, um den Schlüssel und seine Maßnahmen anzuzeigen.</Empty>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
