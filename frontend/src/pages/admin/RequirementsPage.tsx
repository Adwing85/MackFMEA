import { useMemo, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useConfirm } from "../../components/ui";
import { SCOPE_LABELS } from "../../format";
import { useAction, useResource } from "../../hooks";
import type { Attribute, Requirement, Standard } from "../../types";

type Form = Omit<Requirement, "id" | "standard_code">;
const LEVELS = [0, 1, 2, 3, 4];

function ScRange({ min, max }: { min: number; max: number }) {
  return (
    <span className="row" style={{ gap: 2, flexWrap: "nowrap" }} title={`SC${min} bis SC${max}`}>
      {LEVELS.map((l) => (
        <span
          key={l}
          className={l >= min && l <= max ? `badge sc sc-${l}` : "badge badge-muted"}
          style={{ padding: "1px 5px", fontSize: 10.5, opacity: l >= min && l <= max ? 1 : 0.5 }}
        >
          {l}
        </span>
      ))}
    </span>
  );
}

function RequirementDialog({
  requirement,
  attributes,
  standards,
  categories,
  onClose,
  onSaved,
}: {
  requirement: Requirement | null;
  attributes: Attribute[];
  standards: Standard[];
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<Form>(
    requirement ?? { code: "", standard_id: null, scope: "bauteil", category: "", text: "", sc_min: 0, sc_max: 4, conditions: {}, sort_order: 100, active: true },
  );
  const toggle = (attr: string, code: string) => {
    const current = form.conditions[attr] ?? [];
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    const conditions = { ...form.conditions, [attr]: next };
    if (next.length === 0) delete conditions[attr];
    setForm({ ...form, conditions });
  };
  const submit = async () => {
    const ok = await run(() => (requirement ? api.put(`/api/catalog/requirements/${requirement.id}`, form) : api.post("/api/catalog/requirements", form)));
    if (ok) onSaved();
  };
  return (
    <Modal
      wide
      title={requirement ? `Anforderung ${requirement.code}` : "Neue Anforderungsregel"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.code || !form.text || !form.category}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Code" required>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="R-BT-050" />
        </Field>
        <Field label="Werknorm">
          <select value={form.standard_id ?? ""} onChange={(e) => setForm({ ...form, standard_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">–</option>
            {standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} – {s.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bereich">
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Form["scope"] })}>
            <option value="halbzeug">Halbzeug</option>
            <option value="bauteil">Bauteil</option>
          </select>
        </Field>
        <Field label="Kategorie" required>
          <input list="req-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id="req-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Anforderung" required className="full">
          <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={3} />
        </Field>
        <Field label="Gültig ab SC-Klasse" hint="Die Regel gilt für alle Bauteile mit SC-Klasse im Bereich min … max">
          <select value={form.sc_min} onChange={(e) => setForm({ ...form, sc_min: Number(e.target.value) })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                SC{l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gültig bis SC-Klasse" hint="< SC4 nur, wenn eine strengere Regel sie ab der nächsten Klasse ersetzt">
          <select value={form.sc_max} onChange={(e) => setForm({ ...form, sc_max: Number(e.target.value) })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                SC{l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Anwendbarkeit (Bedingungen)" group hint="Je Merkmal ODER-verknüpft, zwischen Merkmalen UND-verknüpft. Keine Auswahl = gilt für alle Bauteile.">
        <div className="stack" style={{ gap: 10 }}>
          {attributes.map((a) => (
            <div key={a.code}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
                {a.name}
              </div>
              <div className="choice-group">
                {a.options.map((o) => (
                  <button
                    type="button"
                    key={o.code}
                    className={`choice${(form.conditions[a.code] ?? []).includes(o.code) ? " selected" : ""}`}
                    onClick={() => toggle(a.code, o.code)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> aktiv
      </label>
    </Modal>
  );
}

export function RequirementsPage() {
  const { confirm, dialog } = useConfirm();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data, error, loading, reload } = useResource<Requirement[]>("/api/catalog/requirements");
  const attributes = useResource<Attribute[]>("/api/catalog/attributes");
  const standards = useResource<Standard[]>("/api/catalog/standards");
  const [editing, setEditing] = useState<Requirement | null | "new">(null);
  const [scope, setScope] = useState("");
  const [level, setLevel] = useState("");
  const [filter, setFilter] = useState("");
  const del = useAction();

  const categories = useMemo(() => [...new Set((data ?? []).map((r) => r.category))].sort(), [data]);
  const optionLabel = (attr: string, code: string) => attributes.data?.find((a) => a.code === attr)?.options.find((o) => o.code === code)?.label ?? code;
  const rows = (data ?? []).filter(
    (r) =>
      (!scope || r.scope === scope) &&
      (level === "" || (r.sc_min <= Number(level) && r.sc_max >= Number(level))) &&
      `${r.code} ${r.text} ${r.category}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const unconditional = (data ?? []).filter((r) => r.active && Object.keys(r.conditions).length === 0);

  const remove = async (r: Requirement) => {
    if (!(await confirm(`Anforderung ${r.code} löschen? (Alternativ deaktivieren)`))) return;
    const ok = await del.run(async () => {
      await api.del(`/api/catalog/requirements/${r.id}`);
      return true;
    });
    if (ok) await reload();
  };

  return (
    <>
      <PageHeader
        title="Anforderungsregeln"
        subtitle="Regeltabelle der Werknormen: Anforderungen an Halbzeug und Bauteil je SC-Klasse und Merkmalskombination"
        actions={isAdmin && <Button variant="primary" onClick={() => setEditing("new")}>+ Regel</Button>}
      />
      <ErrorBox error={error ?? del.error} onClose={() => del.setError(null)} />
      <Card title="Grundumfang je SC-Klasse (Regeln ohne Bedingungen)" className="" >
        <table className="table matrix">
          <thead>
            <tr>
              <th className="label">Bereich</th>
              {LEVELS.map((l) => (
                <th key={l}>SC{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["halbzeug", "bauteil"] as const).map((s) => (
              <tr key={s}>
                <td className="label">{SCOPE_LABELS[s]}</td>
                {LEVELS.map((l) => (
                  <td key={l}>
                    <strong>{unconditional.filter((r) => r.scope === s && r.sc_min <= l && r.sc_max >= l).length}</strong>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Hinzu kommen bedingte Regeln, die nur für bestimmte Bauteilarten, Werkstoffe, Belastungen usw. gelten.
        </p>
      </Card>
      <div style={{ height: 16 }} />
      <Card
        title={`${rows.length} Regeln`}
        actions={
          <div className="filters">
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Halbzeug + Bauteil</option>
              <option value="halbzeug">Halbzeug</option>
              <option value="bauteil">Bauteil</option>
            </select>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">alle SC-Klassen</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  gültig bei SC{l}
                </option>
              ))}
            </select>
            <input type="search" placeholder="Suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        }
        flush
      >
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Keine Regeln.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Bereich</th>
                  <th>Kategorie</th>
                  <th>Anforderung</th>
                  <th>SC-Klassen</th>
                  <th>Bedingungen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.active ? undefined : { opacity: 0.5 }}>
                    <td className="mono nowrap">{r.code}</td>
                    <td>{SCOPE_LABELS[r.scope]}</td>
                    <td className="small">{r.category}</td>
                    <td>
                      {r.text}
                      {r.standard_code && <div className="muted small">{r.standard_code}</div>}
                    </td>
                    <td>
                      <ScRange min={r.sc_min} max={r.sc_max} />
                    </td>
                    <td className="small">
                      {Object.keys(r.conditions).length === 0 ? (
                        <span className="muted">alle Bauteile</span>
                      ) : (
                        Object.entries(r.conditions).map(([attr, codes]) => (
                          <div key={attr}>
                            <span className="muted">{attributes.data?.find((a) => a.code === attr)?.name ?? attr}:</span> {codes.map((c) => optionLabel(attr, c)).join(" / ")}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="actions">
                      {isAdmin && (
                        <>
                          <Button size="sm" onClick={() => setEditing(r)}>
                            Bearbeiten
                          </Button>{" "}
                          <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                            ✕
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <RequirementDialog
          requirement={editing === "new" ? null : editing}
          attributes={attributes.data ?? []}
          standards={standards.data ?? []}
          categories={categories}
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
