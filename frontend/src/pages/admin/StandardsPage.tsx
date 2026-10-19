import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useConfirm } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { Standard } from "../../types";

const EMPTY: Omit<Standard, "id"> = { code: "", title: "", revision: "", description: "", active: true };

function StandardDialog({ standard, onClose, onSaved }: { standard: Standard | null; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<Omit<Standard, "id">>(standard ?? EMPTY);
  const submit = async () => {
    const ok = await run(() => (standard ? api.put(`/api/catalog/standards/${standard.id}`, form) : api.post("/api/catalog/standards", form)));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={standard ? `Werknorm ${standard.code}` : "Neue Werknorm"}
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
        <Field label="Kennung" required>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="Ausgabe / Revision">
          <input value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} />
        </Field>
        <Field label="Titel" required className="full">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Beschreibung" className="full">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> aktiv
      </label>
    </Modal>
  );
}

export function StandardsPage() {
  const { confirm, dialog } = useConfirm();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data, error, loading, reload } = useResource<Standard[]>("/api/catalog/standards");
  const [editing, setEditing] = useState<Standard | null | "new">(null);
  const del = useAction();

  const remove = async (s: Standard) => {
    if (!(await confirm(`Werknorm ${s.code} löschen?`))) return;
    const ok = await del.run(async () => {
      await api.del(`/api/catalog/standards/${s.id}`);
      return true;
    });
    if (ok) await reload();
  };

  return (
    <>
      <PageHeader
        title="Werknormen"
        subtitle="Referenzierte Werk- und Fachnormen der Anforderungsregeln und Maßnahmen"
        actions={isAdmin && <Button variant="primary" onClick={() => setEditing("new")}>+ Werknorm</Button>}
      />
      <ErrorBox error={error ?? del.error} />
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>Keine Werknormen.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Kennung</th>
                <th>Titel</th>
                <th>Ausgabe</th>
                <th>Beschreibung</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="mono nowrap">{s.code}</td>
                  <td>{s.title}</td>
                  <td>{s.revision || "–"}</td>
                  <td className="small muted">{s.description}</td>
                  <td>{s.active ? "aktiv" : <span className="muted">inaktiv</span>}</td>
                  <td className="actions">
                    {isAdmin && (
                      <>
                        <Button size="sm" onClick={() => setEditing(s)}>
                          Bearbeiten
                        </Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => remove(s)}>
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
        <StandardDialog
          standard={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {dialog}
    </>
  );
}
