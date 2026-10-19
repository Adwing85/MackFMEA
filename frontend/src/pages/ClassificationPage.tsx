import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Notice, PageHeader, ScBadge } from "../components/ui";
import { asList, fmtDateTime, SCOPE_LABELS } from "../format";
import { useAction, useDebounced, useResource } from "../hooks";
import type { Attribute, AttributeOption, Classification, Component, Preview, ScClass } from "../types";

type Values = Record<string, string[]>;

/** Schlägt anhand der PDM-Materialangabe eine Ausprägung vor (Beispiele in Klammern der Bezeichnung). */
function suggestOption(attribute: Attribute, text: string): AttributeOption | undefined {
  const haystack = text.toLowerCase().replace(/\s+/g, "");
  if (!haystack) return undefined;
  return attribute.options.find((option) => {
    const examples = [...`${option.label} ${option.description}`.matchAll(/\(([^)]*)\)/g)]
      .flatMap((m) => m[1].replace(/z\.\s*B\./gi, "").split(/[,;/]/))
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, ""))
      .filter((t) => t.length >= 3);
    return examples.some((token) => haystack.includes(token));
  });
}

function ChoiceGroup({
  attribute,
  selected,
  onChange,
  disabled,
}: {
  attribute: Attribute;
  selected: string[];
  onChange: (codes: string[]) => void;
  disabled: boolean;
}) {
  const toggle = (code: string) => {
    if (disabled) return;
    if (attribute.multi) onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
    else onChange(selected[0] === code && !attribute.required ? [] : [code]);
  };
  return (
    <div className="choice-group" role={attribute.multi ? "group" : "radiogroup"}>
      {attribute.options.map((option) => (
        <button
          type="button"
          key={option.code}
          className={`choice${selected.includes(option.code) ? " selected" : ""}`}
          onClick={() => toggle(option.code)}
          title={[option.description, option.failure_cause && `Ursache: ${option.failure_cause}`, option.failure_effect && `Folge: ${option.failure_effect}`]
            .filter(Boolean)
            .join("\n")}
          aria-pressed={selected.includes(option.code)}
          disabled={disabled && !selected.includes(option.code)}
        >
          {attribute.multi && (selected.includes(option.code) ? "☑ " : "☐ ")}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ScPicker({ classes, value, onChange, disabled }: { classes: ScClass[]; value: number | null; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="sc-picker">
      {classes.map((sc) => (
        <button
          type="button"
          key={sc.level}
          className={`sc-option sc-l${sc.level}${value === sc.level ? " selected" : ""}`}
          onClick={() => !disabled && onChange(sc.level)}
          aria-pressed={value === sc.level}
          disabled={disabled && value !== sc.level}
        >
          <div className={`sc-code l${sc.level}`}>{sc.code}</div>
          <div className="sc-name">{sc.name}</div>
          <div className="sc-req">{sc.requirement_level}</div>
        </button>
      ))}
    </div>
  );
}

function PreviewPanel({ preview, loading, error }: { preview: Preview | null; loading: boolean; error: string | null }) {
  if (error) return <ErrorBox error={error} />;
  if (!preview) return loading ? <Loading label="Regelwerk wird ausgewertet …" /> : null;
  const max = Math.max(1, ...preview.per_level.map((p) => p.requirements));
  const grouped = (scope: "halbzeug" | "bauteil") => {
    const map = new Map<string, Preview["requirements"]>();
    preview.requirements
      .filter((r) => r.scope === scope)
      .forEach((r) => map.set(r.category, [...(map.get(r.category) ?? []), r]));
    return [...map.entries()];
  };
  const prevention = preview.measures.filter((m) => m.measure_type === "V");
  const detection = preview.measures.filter((m) => m.measure_type === "E");

  return (
    <div className="stack">
      <Card title="Anforderungsumfang je SC-Klasse">
        <div className="level-bars">
          {preview.per_level.map((p) => (
            <div key={p.sc_level} className={`level-bar${p.sc_level === preview.sc_level ? " current" : ""}`}>
              <div className="value">{p.requirements}</div>
              <div className={`bar l${p.sc_level}`} style={{ height: `${(p.requirements / max) * 85}%` }} />
              <div className="label">SC{p.sc_level}</div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Anzahl abgeleiteter Anforderungen für die aktuelle Merkmalskombination. Höhere SC-Klasse = mehr und strengere
          Anforderungen.
        </p>
      </Card>

      <Card
        title={
          <>
            Abgeleitete Anforderungen <ScBadge level={preview.sc_level} />
          </>
        }
        actions={<span className="muted small">{preview.requirements.length} Anforderungen</span>}
      >
        {preview.sc_class && (
          <p style={{ marginTop: 0 }}>
            <strong>{preview.sc_class.name}</strong> – {preview.sc_class.requirement_level}. Bedeutung (B) in der FMEA:{" "}
            <strong>{preview.sc_class.default_severity}</strong>
          </p>
        )}
        {(["halbzeug", "bauteil"] as const).map((scope) => (
          <div key={scope} style={{ marginBottom: 12 }}>
            <div className="list-title">
              {SCOPE_LABELS[scope]} <span className="pill">{preview.requirements.filter((r) => r.scope === scope).length}</span>
            </div>
            {grouped(scope).map(([category, reqs]) => (
              <div key={category} style={{ marginBottom: 8 }}>
                <div className="small muted" style={{ fontWeight: 600 }}>
                  {category}
                </div>
                {reqs.map((r) => (
                  <div key={r.code} className="small" style={{ margin: "3px 0" }}>
                    <span className="mono muted">{r.code}</span> {r.text}
                    {r.standard_code && <span className="muted"> ({r.standard_code})</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </Card>

      <Card title="Schlüssel und Maßnahmen" actions={<span className="muted small">{preview.keys.length} Schlüssel</span>}>
        <div style={{ marginBottom: 12 }}>
          {preview.keys.map((k) => (
            <span key={k.code} className="tag mono" title={`${k.attribute_name}: ${k.option_label} – ${k.measures.length} Maßnahmen`}>
              {k.code} <span className="muted">({k.measures.length})</span>
            </span>
          ))}
        </div>
        <div className="grid grid-2">
          {[
            ["Vermeidungsmaßnahmen", prevention, "A"] as const,
            ["Entdeckungsmaßnahmen", detection, "E"] as const,
          ].map(([title, list, rating]) => (
            <div key={title}>
              <div className="list-title">
                {title} <span className="pill">{list.length}</span>
              </div>
              {list.length === 0 && <div className="muted small">keine</div>}
              {list.map((m) => (
                <div key={m.code} className="control-line small" title={`aus ${m.keys.join(", ")}`}>
                  <span className="code">{m.code}</span>
                  {m.title}
                  {m.extent && <span className="extent"> · {m.extent}</span>}
                  <span className="muted">
                    {" "}
                    · {rating} {m.rating}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function ClassificationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const readOnly = !hasRole("konstrukteur", "admin");
  const component = useResource<Component>(`/api/components/${id}`);
  const history = useResource<Classification[]>(`/api/components/${id}/classifications`);
  const attributes = useResource<Attribute[]>("/api/catalog/attributes");
  const scClasses = useResource<ScClass[]>("/api/catalog/sc-classes");
  const save = useAction();

  const [designation, setDesignation] = useState("");
  const [designation2, setDesignation2] = useState("");
  const [fn, setFn] = useState("");
  const [values, setValues] = useState<Values>({});
  const [scLevel, setScLevel] = useState<number | null>(null);
  const [justification, setJustification] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);

  const current = component.data?.classification ?? null;

  useEffect(() => {
    if (initialized || !component.data || !attributes.data) return;
    const c = component.data;
    if (c.classification) {
      const cls = c.classification;
      setDesignation(cls.designation);
      setDesignation2(cls.designation2);
      setFn(cls.function);
      setScLevel(cls.sc_level);
      setJustification(cls.justification);
      setValues(Object.fromEntries(Object.entries(cls.values).map(([k, v]) => [k, asList(v)])));
    } else {
      setDesignation(c.name);
      setDesignation2(c.name2);
      const mat = attributes.data.find((a) => a.code === "MAT");
      const option = mat && suggestOption(mat, c.material_pdm);
      if (mat && option) {
        setValues({ [mat.code]: [option.code] });
        setSuggested(`Material „${option.label}“ wurde aus den PDM-Stammdaten (${c.material_pdm}) vorgeschlagen.`);
      }
    }
    setInitialized(true);
  }, [component.data, attributes.data, initialized]);

  const debouncedValues = useDebounced(values, 250);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (scLevel === null) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    api
      .post<Preview>("/api/rules/preview", { values: debouncedValues, sc_level: scLevel })
      .then((p) => !cancelled && (setPreview(p), setPreviewError(null)))
      .catch((err) => !cancelled && setPreviewError(errorText(err)))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedValues, scLevel]);

  const lists = useMemo(() => {
    const attrs = attributes.data ?? [];
    return { list1: attrs.filter((a) => a.list_no === 1), list2: attrs.filter((a) => a.list_no === 2) };
  }, [attributes.data]);

  if (component.loading && !component.data) return <Loading />;
  if (!component.data) return <ErrorBox error={component.error ?? "Bauteil nicht gefunden"} />;
  const c = component.data;

  const scChanged = current !== null && scLevel !== null && current.sc_level !== scLevel;
  const justificationRequired = scLevel !== null && (scLevel >= 2 || scChanged);
  const missing = (attributes.data ?? []).filter((a) => a.required && !(values[a.code]?.length));
  const canSave = !readOnly && scLevel !== null && missing.length === 0 && (!justificationRequired || justification.trim().length > 0);

  const submit = async () => {
    if (scLevel === null) return;
    const result = await save.run(() =>
      api.post<Classification>(`/api/components/${c.id}/classifications`, {
        designation,
        designation2,
        function: fn,
        sc_level: scLevel,
        values,
        justification,
      }),
    );
    if (result) navigate(`/baugruppen/${c.assembly_id}`);
  };

  const renderAttribute = (attribute: Attribute) => (
    <Field
      key={attribute.code}
      label={
        <>
          {attribute.name}
          {attribute.multi && <span className="muted"> (Mehrfachauswahl)</span>}
        </>
      }
      required={attribute.required}
      group
      hint={attribute.code === "MAT" && c.material_pdm ? `PDM-Stammdaten: ${c.material_pdm}` : attribute.description || undefined}
    >
      <ChoiceGroup
        attribute={attribute}
        selected={values[attribute.code] ?? []}
        onChange={(codes) => setValues({ ...values, [attribute.code]: codes })}
        disabled={readOnly}
      />
    </Field>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/baugruppen">Baugruppen</Link> / <Link to={`/baugruppen/${c.assembly_id}`}>Stückliste</Link>
          </>
        }
        title={
          <>
            Bauteilklassifikation · <span className="mono">{c.drawing_number}</span> {c.name}
          </>
        }
        subtitle={current ? `Aktuelle Version v${current.version} · ${current.created_by_name} · ${fmtDateTime(current.created_at)}` : "Noch nicht klassifiziert"}
        actions={
          !readOnly && (
            <>
              <Button onClick={() => navigate(`/baugruppen/${c.assembly_id}`)}>Abbrechen</Button>
              <Button variant="primary" onClick={submit} busy={save.busy} disabled={!canSave}>
                {current ? "Als neue Version speichern" : "Klassifikation speichern"}
              </Button>
            </>
          )
        }
      />
      <ErrorBox error={save.error ?? attributes.error ?? scClasses.error} />
      {readOnly && <Notice>Nur-Lese-Ansicht: Klassifikationen werden vom Konstrukteur erfasst.</Notice>}
      {suggested && !readOnly && <Notice kind="info">{suggested}</Notice>}

      <div className="split">
        <div className="stack">
          <Card title="Liste 1 – Merkmale">
            <div className="form-grid">
              <Field label="Bezeichnung">
                <input value={designation} onChange={(e) => setDesignation(e.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Bezeichnung 2">
                <input value={designation2} onChange={(e) => setDesignation2(e.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Funktion" className="full" hint="Funktion des Bauteils – erscheint als „Funktion des betrachteten Elements“ in der FMEA">
                <textarea value={fn} onChange={(e) => setFn(e.target.value)} disabled={readOnly} rows={2} />
              </Field>
            </div>
            {lists.list1.map(renderAttribute)}
          </Card>

          <Card title="Liste 2 – Klassifikation">
            {lists.list2.map(renderAttribute)}
            <Field label="SC-Klasse (Safety Characteristic)" required group>
              {scClasses.data && <ScPicker classes={scClasses.data} value={scLevel} onChange={setScLevel} disabled={readOnly} />}
            </Field>
            <Field
              label="Begründung der SC-Klasse"
              required={justificationRequired}
              hint={scChanged ? `Änderung von SC${current?.sc_level} auf SC${scLevel} – Begründung wird im Auditlog dokumentiert.` : "Pflicht ab SC2 und bei jeder Änderung der SC-Klasse"}
            >
              <textarea value={justification} onChange={(e) => setJustification(e.target.value)} disabled={readOnly} rows={2} />
            </Field>
            {!readOnly && missing.length > 0 && (
              <p className="muted small">Noch auszufüllen: {missing.map((a) => a.name).join(", ")}</p>
            )}
          </Card>

          <Card title="Versionshistorie">
            {!history.data || history.data.length === 0 ? (
              <Empty>Keine früheren Versionen.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>SC</th>
                    <th>Begründung</th>
                    <th>Erfasst</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => (
                    <tr key={h.id}>
                      <td>
                        v{h.version} {h.is_current && <span className="badge badge-muted">aktuell</span>}
                      </td>
                      <td>
                        <ScBadge level={h.sc_level} />
                      </td>
                      <td className="small">{h.justification || "–"}</td>
                      <td className="small nowrap">
                        {h.created_by_name}
                        <div className="muted">{fmtDateTime(h.created_at)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="sticky-panel">
          {scLevel === null ? (
            <Card title="Regelbasierte Anforderungsableitung">
              <Empty>SC-Klasse wählen, um die geltenden Anforderungen, Schlüssel und Maßnahmen zu sehen.</Empty>
            </Card>
          ) : (
            <PreviewPanel preview={preview} loading={previewLoading} error={previewError} />
          )}
        </div>
      </div>
    </>
  );
}
