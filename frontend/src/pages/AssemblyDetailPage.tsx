import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ApBadge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, ScBadge, StatusBadge, useConfirm } from "../components/ui";
import { asList, fmtDateTime, shortLabel } from "../format";
import { useAction, useResource } from "../hooks";
import type { AssemblyDetail, Attribute, Component, FmeaDetail } from "../types";

function GenerateDialog({ assembly, onClose }: { assembly: AssemblyDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({
    title: `Design-FMEA ${assembly.name}`,
    team: "",
    responsible: user?.full_name || user?.username || "",
    confidentiality: "Intern",
  });
  const unclassified = assembly.components.filter((c) => !c.classification);

  const submit = async () => {
    const doc = await run(() => api.post<FmeaDetail>(`/api/assemblies/${assembly.id}/fmea/generate`, form));
    if (doc) navigate(`/fmea/${doc.id}`);
  };

  return (
    <Modal
      title="FMEA generieren"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={assembly.classified_count === 0}>
            Generieren
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p className="muted" style={{ marginTop: 0 }}>
        Die FMEA wird aus der aktuellen Stückliste, den Klassifikationen (Liste 1 / Liste 2) und dem gültigen Regelwerk
        erzeugt. Es entsteht eine neue Version im Status „Entwurf“.
      </p>
      {unclassified.length > 0 && (
        <Notice kind="warning">
          {unclassified.length} Bauteil(e) sind nicht klassifiziert und werden nicht berücksichtigt:{" "}
          {unclassified.map((c) => c.drawing_number || c.name).join(", ")}
        </Notice>
      )}
      <Field label="Titel">
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Funktionsübergreifendes Team" hint="z. B. Konstruktion, Berechnung, QS, Fertigung">
        <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Konstruktionsverantwortung">
          <input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} />
        </Field>
        <Field label="Vertraulichkeit">
          <select value={form.confidentiality} onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}>
            <option>Öffentlich</option>
            <option>Intern</option>
            <option>Vertraulich</option>
            <option>Streng vertraulich</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

type ComponentForm = Pick<Component, "position" | "level" | "drawing_number" | "name" | "name2" | "quantity" | "material_pdm">;

function ComponentDialog({
  assemblyId,
  component,
  onClose,
  onSaved,
}: {
  assemblyId: number;
  component: Component | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<ComponentForm>(
    component ?? { position: "", level: 1, drawing_number: "", name: "", name2: "", quantity: 1, material_pdm: "" },
  );
  const set = (key: keyof ComponentForm) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: key === "level" || key === "quantity" ? Number(e.target.value) : e.target.value });

  const submit = async () => {
    const ok = await run(() =>
      component
        ? api.put(`/api/components/${component.id}`, form)
        : api.post(`/api/assemblies/${assemblyId}/components`, form),
    );
    if (ok) onSaved();
  };

  return (
    <Modal
      title={component ? "Bauteil bearbeiten" : "Bauteil hinzufügen"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.name}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Position">
          <input value={form.position} onChange={set("position")} />
        </Field>
        <Field label="Strukturstufe">
          <input type="number" min={1} max={20} value={form.level} onChange={set("level")} />
        </Field>
        <Field label="Zeichnungsnummer">
          <input value={form.drawing_number} onChange={set("drawing_number")} />
        </Field>
        <Field label="Menge">
          <input type="number" min={0} step="any" value={form.quantity} onChange={set("quantity")} />
        </Field>
        <Field label="Bezeichnung" required>
          <input value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Bezeichnung 2">
          <input value={form.name2} onChange={set("name2")} />
        </Field>
        <Field label="Material (PDM-Stammdaten)" className="full">
          <input value={form.material_pdm} onChange={set("material_pdm")} />
        </Field>
      </div>
    </Modal>
  );
}

function EditAssemblyDialog({ assembly, onClose, onSaved }: { assembly: AssemblyDetail; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({
    drawing_number: assembly.drawing_number,
    name: assembly.name,
    revision: assembly.revision,
    function: assembly.function,
    description: assembly.description,
  });
  const submit = async () => {
    if (await run(() => api.put(`/api/assemblies/${assembly.id}`, form))) onSaved();
  };
  return (
    <Modal
      title="Baugruppe bearbeiten"
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
      <div className="form-grid">
        <Field label="Zeichnungsnummer">
          <input value={form.drawing_number} onChange={(e) => setForm({ ...form, drawing_number: e.target.value })} />
        </Field>
        <Field label="Revision">
          <input value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} />
        </Field>
        <Field label="Benennung" className="full">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Funktion der Baugruppe (nächsthöhere Ebene in der FMEA)" className="full">
          <textarea value={form.function} onChange={(e) => setForm({ ...form, function: e.target.value })} />
        </Field>
        <Field label="Beschreibung" className="full">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function AssemblyDetailPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canEdit = hasRole("konstrukteur", "admin");
  const { data: assembly, error, loading, reload } = useResource<AssemblyDetail>(`/api/assemblies/${id}`);
  const { data: attributes } = useResource<Attribute[]>("/api/catalog/attributes");
  const action = useAction();
  const [dialog, setDialog] = useState<"generate" | "component" | "edit" | null>(null);
  const [editComponent, setEditComponent] = useState<Component | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (loading && !assembly) return <Loading />;
  if (!assembly) return <ErrorBox error={error ?? "Baugruppe nicht gefunden"} />;

  const label = (attrCode: string, value: string | string[] | undefined) => {
    const attr = attributes?.find((a) => a.code === attrCode);
    return asList(value)
      .map((code) => shortLabel(attr?.options.find((o) => o.code === code)?.label ?? code))
      .join(", ");
  };

  const refreshFromPdm = async () => {
    const result = await action.run(() => api.post<AssemblyDetail>(`/api/assemblies/${assembly.id}/pdm-refresh`));
    if (result) {
      setMessage("Stückliste wurde mit dem PDM abgeglichen (Details im Auditlog).");
      await reload();
    }
  };

  const deleteComponent = async (component: Component) => {
    if (!(await confirm(`Bauteil ${component.drawing_number} ${component.name} inkl. Klassifikationshistorie löschen?`))) return;
    const ok = await action.run(async () => {
      await api.del(`/api/components/${component.id}`);
      return true;
    });
    if (ok) await reload();
  };

  const deleteAssembly = async () => {
    if (!(await confirm(`Baugruppe ${assembly.drawing_number} mit allen Bauteilen und FMEA-Entwürfen löschen?`))) return;
    const ok = await action.run(async () => {
      await api.del(`/api/assemblies/${assembly.id}`);
      return true;
    });
    if (ok) navigate("/baugruppen");
  };

  const progress = assembly.component_count ? Math.round((assembly.classified_count / assembly.component_count) * 100) : 0;

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/baugruppen">Baugruppen</Link>}
        title={
          <>
            <span className="mono" style={{ fontSize: 20 }}>
              {assembly.drawing_number}
            </span>{" "}
            {assembly.name}
          </>
        }
        subtitle={`Revision ${assembly.revision || "–"} · Quelle: ${assembly.source}${assembly.pdm_ref ? ` (${assembly.pdm_ref})` : ""}`}
        actions={
          <>
            {canEdit && assembly.source.startsWith("pdm") && (
              <Button onClick={refreshFromPdm} busy={action.busy}>
                Stückliste aus PDM abgleichen
              </Button>
            )}
            {canEdit && <Button onClick={() => setDialog("edit")}>Bearbeiten</Button>}
            {hasRole("admin") && (
              <Button variant="danger" onClick={deleteAssembly}>
                Löschen
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" onClick={() => setDialog("generate")} disabled={assembly.classified_count === 0}>
                FMEA generieren
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={action.error} onClose={() => action.setError(null)} />
      {message && <Notice kind="success">{message}</Notice>}

      <div className="stack">
        <Card
          title={`Stückliste (${assembly.component_count} Positionen)`}
          actions={
            <>
              <span className="muted small">
                Klassifiziert: {assembly.classified_count} / {assembly.component_count} ({progress} %)
              </span>
              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditComponent(null);
                    setDialog("component");
                  }}
                >
                  + Bauteil
                </Button>
              )}
            </>
          }
        >
          {assembly.function && (
            <p style={{ marginTop: 0 }}>
              <span className="muted">Funktion: </span>
              {assembly.function}
            </p>
          )}
          {assembly.components.length === 0 ? (
            <Empty>Keine Positionen vorhanden.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pos.</th>
                    <th>Zeichnungsnr.</th>
                    <th>Bezeichnung</th>
                    <th className="right">Menge</th>
                    <th>Material (PDM)</th>
                    <th>SC</th>
                    <th>Klassifikation</th>
                    <th>Schadensbilder</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {assembly.components.map((c) => {
                    const cls = c.classification;
                    return (
                      <tr key={c.id}>
                        <td className="mono">{c.position}</td>
                        <td className="mono">{c.drawing_number}</td>
                        <td className={c.level > 1 ? `indent-${Math.min(c.level, 3)}` : ""}>
                          {c.level > 1 && <span className="muted">└ </span>}
                          {c.name}
                          {c.name2 && <div className="muted small">{c.name2}</div>}
                        </td>
                        <td className="right nowrap">
                          {c.quantity} {c.unit}
                        </td>
                        <td className="small">{c.material_pdm || "–"}</td>
                        <td>
                          <ScBadge level={cls?.sc_level} />
                        </td>
                        <td className="small">
                          {cls ? (
                            <>
                              {label("BA", cls.values.BA)} · {label("MAT", cls.values.MAT)}
                              <div className="muted">
                                v{cls.version} · {cls.created_by_name} · {fmtDateTime(cls.created_at)}
                              </div>
                            </>
                          ) : (
                            <span className="muted">nicht klassifiziert</span>
                          )}
                        </td>
                        <td className="small">{cls ? label("SD", cls.values.SD) : "–"}</td>
                        <td className="actions">
                          <Button size="sm" variant={cls ? "secondary" : "primary"} onClick={() => navigate(`/bauteile/${c.id}/klassifikation`)}>
                            {cls ? (canEdit ? "Klassifikation ändern" : "Anzeigen") : canEdit ? "Klassifizieren" : "Anzeigen"}
                          </Button>{" "}
                          {canEdit && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditComponent(c);
                                  setDialog("component");
                                }}
                              >
                                Bearbeiten
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteComponent(c)} title="Löschen">
                                ✕
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="FMEA-Versionen">
          {assembly.fmeas.length === 0 ? (
            <Empty>Noch keine FMEA generiert.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>FMEA-Nr.</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Zeilen</th>
                  <th>Aufgabenpriorität</th>
                  <th>Erstellt</th>
                  <th>Geprüft</th>
                </tr>
              </thead>
              <tbody>
                {assembly.fmeas.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => navigate(`/fmea/${f.id}`)}>
                    <td className="mono">
                      <Link to={`/fmea/${f.id}`}>{f.fmea_number}</Link>
                    </td>
                    <td>V{f.version}</td>
                    <td>
                      <StatusBadge status={f.status} />
                    </td>
                    <td>{f.rows}</td>
                    <td>
                      <span className="row">
                        {(["H", "M", "L"] as const).map((ap) => (
                          <span key={ap} className="nowrap">
                            <ApBadge ap={ap} /> {f.ap_counts[ap]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="small">
                      {f.created_by} · {fmtDateTime(f.created_at)}
                    </td>
                    <td className="small">{f.reviewed_by || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {dialog === "generate" && <GenerateDialog assembly={assembly} onClose={() => setDialog(null)} />}
      {dialog === "edit" && (
        <EditAssemblyDialog
          assembly={assembly}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
      {dialog === "component" && (
        <ComponentDialog
          assemblyId={assembly.id}
          component={editComponent}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}
