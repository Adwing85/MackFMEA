import { useState } from "react";
import { api } from "../../api";
import { actionPriority } from "../../ap";
import { useAction } from "../../hooks";
import type { FmeaRow } from "../../types";
import { ApBadge, Button, ErrorBox, Field, Modal, MultilineText } from "../ui";

const RATINGS = Array.from({ length: 10 }, (_, i) => i + 1);
const STATUS = ["", "offen", "in Bearbeitung", "umgesetzt", "verworfen"];

type Editable = Pick<
  FmeaRow,
  | "failure_effect"
  | "severity"
  | "failure_mode"
  | "failure_cause"
  | "prevention_controls"
  | "occurrence"
  | "detection_controls"
  | "detection"
  | "opt_prevention"
  | "opt_detection"
  | "opt_responsible"
  | "opt_target_date"
  | "opt_status"
  | "opt_occurrence"
  | "opt_detection_rating"
  | "remarks"
>;

function RatingSelect({ value, onChange, allowEmpty, disabled }: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean; disabled?: boolean }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled}>
      {allowEmpty && <option value="">–</option>}
      {RATINGS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

export function RowDialog({
  fmeaId,
  row,
  editable,
  onClose,
  onSaved,
}: {
  fmeaId: number;
  row: FmeaRow;
  editable: boolean;
  onClose: () => void;
  onSaved: (row: FmeaRow) => void;
}) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState<Editable>({
    failure_effect: row.failure_effect,
    severity: row.severity,
    failure_mode: row.failure_mode,
    failure_cause: row.failure_cause,
    prevention_controls: row.prevention_controls,
    occurrence: row.occurrence,
    detection_controls: row.detection_controls,
    detection: row.detection,
    opt_prevention: row.opt_prevention,
    opt_detection: row.opt_detection,
    opt_responsible: row.opt_responsible,
    opt_target_date: row.opt_target_date,
    opt_status: row.opt_status,
    opt_occurrence: row.opt_occurrence,
    opt_detection_rating: row.opt_detection_rating,
    remarks: row.remarks,
  });
  const [reason, setReason] = useState("");
  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => setForm({ ...form, [key]: value });
  const text = (key: keyof Editable) => (e: { target: { value: string } }) => set(key, e.target.value as never);

  const ap = actionPriority(form.severity, form.occurrence, form.detection);
  const optAp =
    form.opt_occurrence || form.opt_detection_rating
      ? actionPriority(form.severity, form.opt_occurrence ?? form.occurrence, form.opt_detection_rating ?? form.detection)
      : null;

  const changed = (Object.keys(form) as (keyof Editable)[]).filter((k) => form[k] !== row[k]);
  const submit = async () => {
    const payload: Record<string, unknown> = { change_reason: reason };
    changed.forEach((k) => (payload[k] = form[k]));
    const saved = await run(() => api.put<FmeaRow>(`/api/fmea/${fmeaId}/rows/${row.id}`, payload));
    if (saved) onSaved(saved);
  };

  return (
    <Modal
      wide
      title={
        <>
          {row.focus_element} · {row.failure_mode}
        </>
      }
      onClose={onClose}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={submit} busy={busy} disabled={changed.length === 0}>
              Speichern ({changed.length} Änderung{changed.length === 1 ? "" : "en"})
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Schließen</Button>
        )
      }
    >
      <ErrorBox error={error} />
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Nächsthöhere Ebene</dt>
        <dd>{row.higher_level}</dd>
        <dt>Merkmal (nächstniedrigere Ebene)</dt>
        <dd>{row.lower_level}</dd>
        <dt>Funktion</dt>
        <dd>{row.function_focus || "–"}</dd>
        <dt>Anforderung Merkmal</dt>
        <dd>{row.function_lower || "–"}</dd>
        <dt>Schlüssel</dt>
        <dd>
          {row.key_codes.map((k) => (
            <span key={k} className="tag mono">
              {k}
            </span>
          ))}
        </dd>
      </dl>

      <div className="grid grid-2">
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Fehler- und Risikoanalyse</h3>
          <Field label="Fehlerfolge (FE)">
            <textarea value={form.failure_effect} onChange={text("failure_effect")} disabled={!editable} rows={2} />
          </Field>
          <div className="form-grid">
            <Field label="Fehlerart (FM)">
              <input value={form.failure_mode} onChange={text("failure_mode")} disabled={!editable} />
            </Field>
            <Field label="Bedeutung (B)">
              <RatingSelect value={form.severity} onChange={(v) => set("severity", v ?? 1)} disabled={!editable} />
            </Field>
          </div>
          <Field label="Fehlerursache (FC)">
            <textarea value={form.failure_cause} onChange={text("failure_cause")} disabled={!editable} rows={2} />
          </Field>
          <Field label="Vermeidungsmaßnahmen (PC)" group={!editable}>
            {editable ? <textarea value={form.prevention_controls} onChange={text("prevention_controls")} rows={5} /> : <MultilineText text={form.prevention_controls} />}
          </Field>
          <Field label="Entdeckungsmaßnahmen (DC)" group={!editable}>
            {editable ? <textarea value={form.detection_controls} onChange={text("detection_controls")} rows={5} /> : <MultilineText text={form.detection_controls} />}
          </Field>
          <div className="row">
            <Field label="Auftreten (A)">
              <RatingSelect value={form.occurrence} onChange={(v) => set("occurrence", v ?? 1)} disabled={!editable} />
            </Field>
            <Field label="Entdeckung (E)">
              <RatingSelect value={form.detection} onChange={(v) => set("detection", v ?? 1)} disabled={!editable} />
            </Field>
            <Field label="Aufgabenpriorität" group>
              <div style={{ paddingTop: 6 }}>
                <ApBadge ap={ap} /> <span className="muted small">RPZ {form.severity * form.occurrence * form.detection}</span>
              </div>
            </Field>
          </div>
        </div>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Optimierung</h3>
          {ap === "H" && <p className="small" style={{ color: "var(--ap-h-text)", marginTop: 0 }}>AP hoch: Maßnahme mit Verantwortlichem festlegen oder Begründung dokumentieren (Voraussetzung für die Freigabe).</p>}
          <Field label="Vermeidungsmaßnahme" hint="Vorschläge stammen aus Schlüsseln höherer SC-Klassen">
            <textarea value={form.opt_prevention} onChange={text("opt_prevention")} disabled={!editable} rows={3} />
          </Field>
          <Field label="Entdeckungsmaßnahme">
            <textarea value={form.opt_detection} onChange={text("opt_detection")} disabled={!editable} rows={3} />
          </Field>
          <div className="form-grid">
            <Field label="Verantwortlich">
              <input value={form.opt_responsible} onChange={text("opt_responsible")} disabled={!editable} />
            </Field>
            <Field label="Zieltermin">
              <input type="date" value={form.opt_target_date} onChange={text("opt_target_date")} disabled={!editable} />
            </Field>
            <Field label="Status">
              <select value={form.opt_status} onChange={text("opt_status")} disabled={!editable}>
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s || "–"}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Field label="A neu">
                <RatingSelect value={form.opt_occurrence} onChange={(v) => set("opt_occurrence", v)} allowEmpty disabled={!editable} />
              </Field>
              <Field label="E neu">
                <RatingSelect value={form.opt_detection_rating} onChange={(v) => set("opt_detection_rating", v)} allowEmpty disabled={!editable} />
              </Field>
              <Field label="AP neu" group>
                <div style={{ paddingTop: 6 }}>{optAp ? <ApBadge ap={optAp} /> : <span className="muted">–</span>}</div>
              </Field>
            </div>
          </div>
          <Field label="Bemerkungen">
            <textarea value={form.remarks} onChange={text("remarks")} disabled={!editable} rows={2} />
          </Field>
          {editable && (
            <Field label="Änderungsgrund (Auditlog)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}
