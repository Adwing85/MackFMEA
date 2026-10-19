import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { Measure, Standard } from "../../types";

type Form = Omit<Measure, "id" | "standard_code">;
const EMPTY: Form = { code: "", title: "", description: "", measure_type: "V", rating: 5, standard_id: null, active: true };

function MeasureDialog({ measure, standards, onClose, onSaved }: { measure: Measure | null; standards: Standard[]; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<Form>(measure ?? EMPTY);
  const submit = async () => {
    const ok = await run(() => (measure ? api.put(`/api/catalog/measures/${measure.id}`, form) : api.post("/api/catalog/measures", form)));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={measure ? `Maßnahme ${measure.code}` : "Neue Maßnahme"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.code || !form.title}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Code" required>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="M-V-30" />
        </Field>
        <Field label="Art">
          <select value={form.measure_type} onChange={(e) => setForm({ ...form, measure_type: e.target.value as "V" | "E" })}>
            <option value="V">Vermeidung (Sicherungsmaßnahme)</option>
            <option value="E">Entdeckung (Prüfmaßnahme)</option>
          </select>
        </Field>
        <Field label="Titel" required className="full">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Beschreibung" className="full">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label={form.measure_type === "V" ? "Erreichbares Auftreten (A)" : "Erreichbare Entdeckung (E)"}
          hint="Bewertung 1–10 nach AIAG & VDA; die beste Maßnahme einer Zeile bestimmt den Wert"
        >
          <input type="number" min={1} max={10} value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
        </Field>
        <Field label="Norm">
          <select value={form.standard_id ?? ""} onChange={(e) => setForm({ ...form, standard_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">–</option>
            {standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} – {s.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> aktiv
      </label>
    </Modal>
  );
}

export function MeasuresPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data, error, loading, reload } = useResource<Measure[]>("/api/catalog/measures");
  const standards = useResource<Standard[]>("/api/catalog/standards");
  const [editing, setEditing] = useState<Measure | null | "new">(null);
  const [type, setType] = useState("");
  const [filter, setFilter] = useState("");
  const del = useAction();

  const rows = (data ?? []).filter((m) => (!type || m.measure_type === type) && `${m.code} ${m.title}`.toLowerCase().includes(filter.toLowerCase()));

  const remove = async (m: Measure) => {
    if (!confirm(`Maßnahme ${m.code} löschen?`)) return;
    const ok = await del.run(async () => {
      await api.del(`/api/catalog/measures/${m.id}`);
      return true;
    });
    if (ok) await reload();
  };

  return (
    <>
      <PageHeader
        title="Maßnahmenkatalog"
        subtitle="Prüf- (Entdeckung) und Sicherungsmaßnahmen (Vermeidung), die über die Schlüsseltabelle den Bauteilen zugeordnet werden"
        actions={isAdmin && <Button variant="primary" onClick={() => setEditing("new")}>+ Maßnahme</Button>}
      />
      <ErrorBox error={error ?? del.error} onClose={() => del.setError(null)} />
      <Card
        actions={
          <div className="filters">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Alle Arten</option>
              <option value="V">Vermeidung</option>
              <option value="E">Entdeckung</option>
            </select>
            <input type="search" placeholder="Suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        }
        title={`${rows.length} Maßnahmen`}
      >
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Keine Maßnahmen.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Art</th>
                <th>Maßnahme</th>
                <th className="center">Bewertung</th>
                <th>Norm</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="mono nowrap">{m.code}</td>
                  <td>
                    <span className={`tag tag-${m.measure_type.toLowerCase()}`}>{m.measure_type === "V" ? "Vermeidung" : "Entdeckung"}</span>
                  </td>
                  <td>
                    {m.title}
                    {m.description && <div className="muted small">{m.description}</div>}
                  </td>
                  <td className="center">
                    {m.measure_type === "V" ? "A" : "E"} {m.rating}
                  </td>
                  <td className="small">{m.standard_code || "–"}</td>
                  <td>{m.active ? "aktiv" : <span className="muted">inaktiv</span>}</td>
                  <td className="actions">
                    {isAdmin && (
                      <>
                        <Button size="sm" onClick={() => setEditing(m)}>
                          Bearbeiten
                        </Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => remove(m)}>
                          ✕
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && (
        <MeasureDialog
          measure={editing === "new" ? null : editing}
          standards={standards.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
