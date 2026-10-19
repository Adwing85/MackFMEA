import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { Attribute, AttributeOption } from "../../types";

type AttrForm = Omit<Attribute, "id" | "options">;
type OptionForm = Omit<AttributeOption, "id" | "attribute_id">;

function AttributeDialog({ attribute, onClose, onSaved }: { attribute: Attribute | null; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<AttrForm>(
    attribute ?? { code: "", name: "", list_no: 2, multi: false, required: true, is_failure_mode: false, description: "", sort_order: 100, active: true },
  );
  const submit = async () => {
    const { code, ...rest } = form;
    const ok = await run(() => (attribute ? api.put(`/api/catalog/attributes/${attribute.id}`, rest) : api.post("/api/catalog/attributes", { code, ...rest })));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={attribute ? `Merkmal ${attribute.name}` : "Neues Merkmal"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.code || !form.name}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Code" hint="Großbuchstaben/Ziffern, Teil des Schlüssels" required>
          <input value={form.code} disabled={!!attribute} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Bezeichnung" required>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Liste">
          <select value={form.list_no} onChange={(e) => setForm({ ...form, list_no: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>Liste 1 – Merkmale</option>
            <option value={2}>Liste 2 – Klassifikation</option>
          </select>
        </Field>
        <Field label="Sortierung">
          <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </Field>
        <Field label="Beschreibung / Hilfetext" className="full">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <label className="checkbox">
          <input type="checkbox" checked={form.multi} onChange={(e) => setForm({ ...form, multi: e.target.checked })} /> Mehrfachauswahl
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Pflichtangabe
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.is_failure_mode} onChange={(e) => setForm({ ...form, is_failure_mode: e.target.checked })} /> Ausprägungen
          sind Schadensbilder (Fehlerarten der FMEA)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> aktiv
        </label>
      </div>
    </Modal>
  );
}

function OptionDialog({
  attribute,
  option,
  damages,
  onClose,
  onSaved,
}: {
  attribute: Attribute;
  option: AttributeOption | null;
  damages: AttributeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<OptionForm>(
    option ?? { code: "", label: "", description: "", failure_cause: "", failure_effect: "", relevant_damages: [], sort_order: 100, active: true },
  );
  const toggleDamage = (code: string) =>
    setForm({
      ...form,
      relevant_damages: form.relevant_damages.includes(code) ? form.relevant_damages.filter((d) => d !== code) : [...form.relevant_damages, code],
    });
  const submit = async () => {
    const { code, ...rest } = form;
    const ok = await run(() =>
      option ? api.put(`/api/catalog/options/${option.id}`, rest) : api.post(`/api/catalog/attributes/${attribute.id}/options`, { code, ...rest }),
    );
    if (ok) onSaved();
  };
  return (
    <Modal
      wide
      title={option ? `${attribute.name}: ${option.label}` : `Neue Ausprägung für ${attribute.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.code || !form.label}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      {!option && <Notice>Für die neue Ausprägung werden automatisch fünf Schlüssel (SC0–SC4) in der Schlüsseltabelle angelegt.</Notice>}
      <div className="form-grid">
        <Field label="Code" required hint={`Schlüssel: ${attribute.code}-${form.code || "…"}-SC0 … SC4`}>
          <input value={form.code} disabled={!!option} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
        </Field>
        <Field label="Bezeichnung" required hint="Beispiele in Klammern dienen als Vorschlag aus PDM-Stammdaten">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label="Beschreibung" className="full">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label={attribute.is_failure_mode ? "Generische Fehlerursache (Rückfallebene)" : "Fehlerursache in der FMEA"}
          className="full"
          hint={
            attribute.is_failure_mode
              ? "Wird verwendet, wenn kein Merkmal des Bauteils eine passende Ursache liefert"
              : "Leer = keine eigene Ursachenzeile; die Maßnahmen des Schlüssels gelten dann für alle Zeilen des Bauteils"
          }
        >
          <textarea value={form.failure_cause} onChange={(e) => setForm({ ...form, failure_cause: e.target.value })} rows={2} />
        </Field>
        {attribute.is_failure_mode ? (
          <Field label="Fehlerfolge (FE)" className="full">
            <textarea value={form.failure_effect} onChange={(e) => setForm({ ...form, failure_effect: e.target.value })} rows={2} />
          </Field>
        ) : (
          <Field label="Relevant für Schadensbilder" className="full" group hint="Keine Auswahl = relevant für alle Schadensbilder">
            <div className="choice-group">
              {damages.map((d) => (
                <button type="button" key={d.code} className={`choice${form.relevant_damages.includes(d.code) ? " selected" : ""}`} onClick={() => toggleDamage(d.code)}>
                  {d.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Sortierung">
          <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> aktiv
      </label>
    </Modal>
  );
}

export function AttributesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data, error, loading, reload } = useResource<Attribute[]>(`/api/catalog/attributes?include_inactive=${isAdmin}`);
  const [attrDialog, setAttrDialog] = useState<Attribute | null | "new">(null);
  const [optionDialog, setOptionDialog] = useState<{ attribute: Attribute; option: AttributeOption | null } | null>(null);

  const damages = (data ?? []).filter((a) => a.is_failure_mode).flatMap((a) => a.options);
  const damageLabel = (code: string) => damages.find((d) => d.code === code)?.label ?? code;
  const saved = () => {
    setAttrDialog(null);
    setOptionDialog(null);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Merkmalslisten"
        subtitle="Liste 1 (Merkmale) und Liste 2 (Klassifikation) für das Eingabeformular des Konstrukteurs. Jede Ausprägung ergibt mit jeder SC-Klasse einen Schlüssel."
        actions={isAdmin && <Button variant="primary" onClick={() => setAttrDialog("new")}>+ Merkmal</Button>}
      />
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      <div className="stack">
        {[2, 1].map((list) => (
          <div key={list} className="stack">
            <h2 style={{ fontSize: 16 }}>{list === 1 ? "Liste 1 – Merkmale" : "Liste 2 – Klassifikation"}</h2>
            {list === 1 && <p className="muted" style={{ margin: 0 }}>Zusätzlich erfasst der Konstrukteur je Bauteil die Freitexte Bezeichnung, Bezeichnung 2 und Funktion.</p>}
            {(data ?? [])
              .filter((a) => a.list_no === list)
              .map((attribute) => (
                <Card
                  key={attribute.id}
                  title={
                    <>
                      <span className="mono muted">{attribute.code}</span> {attribute.name}{" "}
                      {attribute.multi && <span className="badge badge-muted">Mehrfachauswahl</span>}{" "}
                      {attribute.is_failure_mode && <span className="badge badge-muted">Schadensbilder / Fehlerarten</span>}{" "}
                      {!attribute.active && <span className="badge badge-muted">inaktiv</span>}
                    </>
                  }
                  actions={
                    isAdmin && (
                      <>
                        <Button size="sm" onClick={() => setAttrDialog(attribute)}>
                          Merkmal bearbeiten
                        </Button>
                        <Button size="sm" onClick={() => setOptionDialog({ attribute, option: null })}>
                          + Ausprägung
                        </Button>
                      </>
                    )
                  }
                  flush
                >
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Ausprägung</th>
                          <th>{attribute.is_failure_mode ? "Fehlerfolge" : "Fehlerursache"}</th>
                          <th>{attribute.is_failure_mode ? "Generische Ursache" : "Relevant für"}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {attribute.options.map((o) => (
                          <tr key={o.id} style={o.active ? undefined : { opacity: 0.5 }}>
                            <td className="mono">{o.code}</td>
                            <td>
                              {o.label}
                              {o.description && <div className="muted small">{o.description}</div>}
                            </td>
                            <td className="small">{(attribute.is_failure_mode ? o.failure_effect : o.failure_cause) || <span className="muted">–</span>}</td>
                            <td className="small">
                              {attribute.is_failure_mode
                                ? o.failure_cause || <span className="muted">–</span>
                                : o.failure_cause
                                  ? o.relevant_damages.length
                                    ? o.relevant_damages.map(damageLabel).join(", ")
                                    : "alle Schadensbilder"
                                  : <span className="muted">alle Zeilen (allgemeines Merkmal)</span>}
                            </td>
                            <td className="actions">
                              {isAdmin && (
                                <Button size="sm" variant="ghost" onClick={() => setOptionDialog({ attribute, option: o })}>
                                  Bearbeiten
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
          </div>
        ))}
      </div>
      {attrDialog && <AttributeDialog attribute={attrDialog === "new" ? null : attrDialog} onClose={() => setAttrDialog(null)} onSaved={saved} />}
      {optionDialog && (
        <OptionDialog attribute={optionDialog.attribute} option={optionDialog.option} damages={damages} onClose={() => setOptionDialog(null)} onSaved={saved} />
      )}
    </>
  );
}
