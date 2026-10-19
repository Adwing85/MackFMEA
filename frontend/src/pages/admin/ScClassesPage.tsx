import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, ScBadge } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { ScClass } from "../../types";

interface Consistency {
  consistent: boolean;
  issues: { type: string; ref: string; message: string; counts: number[] }[];
  totals: { sc_level: number; requirements: number; key_measure_links: number }[];
}

function EditDialog({ sc, onClose, onSaved }: { sc: ScClass; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({
    name: sc.name,
    requirement_level: sc.requirement_level,
    description: sc.description,
    default_severity: sc.default_severity,
    color: sc.color,
  });
  const submit = async () => {
    if (await run(() => api.put(`/api/catalog/sc-classes/${sc.level}`, form))) onSaved();
  };
  return (
    <Modal
      title={`${sc.code} bearbeiten`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <Field label="Bezeichnung">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Anforderungsniveau">
        <input value={form.requirement_level} onChange={(e) => setForm({ ...form, requirement_level: e.target.value })} />
      </Field>
      <Field label="Beschreibung">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Bedeutung (B) in der FMEA" hint="Standardwert der Bedeutung für alle Fehlerfolgen von Bauteilen dieser SC-Klasse (1–10)">
        <input
          type="number"
          min={1}
          max={10}
          value={form.default_severity}
          onChange={(e) => setForm({ ...form, default_severity: Number(e.target.value) })}
        />
      </Field>
    </Modal>
  );
}

export function ScClassesPage() {
  const { hasRole } = useAuth();
  const classes = useResource<ScClass[]>("/api/catalog/sc-classes");
  const consistency = useResource<Consistency>("/api/catalog/consistency");
  const [editing, setEditing] = useState<ScClass | null>(null);

  return (
    <>
      <PageHeader
        title="SC-Klassen"
        subtitle="Safety-Characteristic-Klassen SC0–SC4: Anforderungsniveau und Bedeutung in der FMEA. Höhere SC-Klasse = größeres Anforderungsset."
      />
      <ErrorBox error={classes.error ?? consistency.error} />
      {classes.loading && !classes.data && <Loading />}
      <div className="stack">
        <Card title="Klassen">
          <table className="table">
            <thead>
              <tr>
                <th>SC-Klasse</th>
                <th>Sicherheitsrelevanz</th>
                <th>Anforderungsniveau</th>
                <th className="center">Bedeutung (B)</th>
                <th className="center">Anforderungsregeln</th>
                <th className="center">Schlüssel-Maßnahmen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {classes.data?.map((sc) => {
                const totals = consistency.data?.totals.find((t) => t.sc_level === sc.level);
                return (
                  <tr key={sc.level}>
                    <td>
                      <ScBadge level={sc.level} />
                    </td>
                    <td>
                      <strong>{sc.name}</strong>
                    </td>
                    <td>{sc.requirement_level}</td>
                    <td className="center">{sc.default_severity}</td>
                    <td className="center">{totals?.requirements ?? "–"}</td>
                    <td className="center">{totals?.key_measure_links ?? "–"}</td>
                    <td className="actions">
                      {hasRole("admin") && (
                        <Button size="sm" onClick={() => setEditing(sc)}>
                          Bearbeiten
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Konsistenzprüfung des Regelwerks" actions={<Button size="sm" onClick={() => consistency.reload()}>Erneut prüfen</Button>}>
          {consistency.data &&
            (consistency.data.consistent ? (
              <Notice kind="success">
                Regelwerk ist konsistent: Anzahl der Anforderungen und Maßnahmen nimmt mit steigender SC-Klasse in keiner Regelgruppe und keinem
                Schlüssel ab.
              </Notice>
            ) : (
              <>
                <Notice kind="warning">
                  {consistency.data.issues.length} Stelle(n), an denen der Umfang mit steigender SC-Klasse sinkt. Bitte Regeln bzw. Schlüssel prüfen.
                </Notice>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Bereich</th>
                      <th>Befund</th>
                      <th>SC0 → SC4</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consistency.data.issues.map((issue, i) => (
                      <tr key={i}>
                        <td>{issue.type === "schluessel" ? "Schlüssel" : "Anforderung"}</td>
                        <td>{issue.message}</td>
                        <td className="mono">{issue.counts.join(" → ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ))}
        </Card>
      </div>
      {editing && (
        <EditDialog
          sc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void classes.reload();
          }}
        />
      )}
    </>
  );
}
