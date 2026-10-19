import { useMemo, useState, type ReactNode } from "react";
import type { FmeaRow } from "../../types";
import { ApBadge, Empty } from "../ui";

function Controls({ text, extent = true }: { text: string; extent?: boolean }) {
  if (!text) return <span className="muted">–</span>;
  return (
    <>
      {text.split("\n").map((line, idx) => {
        const match = /^(M-[A-Z]-\d+)\s+(.*?)(\s+\(([^()]*)\))?$/.exec(line);
        if (!match) return <div key={idx} className="control-line">{line}</div>;
        return (
          <div key={idx} className="control-line">
            <span className="code">{match[1]}</span>
            {match[2]}
            {extent && match[4] && <span className="extent"> · {match[4]}</span>}
          </div>
        );
      })}
    </>
  );
}

type Group = "none" | "struktur" | "funktion" | "fehler" | "risiko" | "optimierung";

interface Ctx {
  index: number;
  full: boolean;
  sameComponent: boolean;
  sameMode: boolean;
}

interface Column {
  title: string;
  group: Group;
  compact: boolean;
  full: boolean;
  className?: string;
  minWidth?: number;
  render: (r: FmeaRow, ctx: Ctx) => ReactNode;
}

const GROUP_TITLES: Record<Group, string> = {
  none: "",
  struktur: "Strukturanalyse (Schritt 2)",
  funktion: "Funktionsanalyse (Schritt 3)",
  fehler: "Fehleranalyse (Schritt 4)",
  risiko: "Risikoanalyse (Schritt 5)",
  optimierung: "Optimierung (Schritt 6)",
};

const dash = <span className="muted">–</span>;
/** Wiederholte Werte wie verbundene Zellen im Formblatt nur einmal zeigen. */
const once = (show: boolean, value: ReactNode) => (show ? value : null);

const COLUMNS: Column[] = [
  { title: "Nr.", group: "none", compact: true, full: true, className: "center muted", render: (_, c) => c.index },
  { title: "Nächsthöhere Ebene", group: "struktur", compact: false, full: true, minWidth: 140, render: (r, c) => once(!c.sameComponent, r.higher_level) },
  {
    title: "Betrachtetes Element",
    group: "struktur",
    compact: true,
    full: true,
    minWidth: 160,
    render: (r, c) => once(!c.sameComponent, <strong>{r.focus_element}</strong>),
  },
  { title: "Nächstniedrigere Ebene / Merkmal", group: "struktur", compact: true, full: true, minWidth: 150, render: (r) => r.lower_level },
  { title: "Funktion nächsthöhere Ebene", group: "funktion", compact: false, full: true, minWidth: 160, render: (r, c) => once(!c.sameComponent, r.function_higher || dash) },
  { title: "Funktion betrachtetes Element", group: "funktion", compact: false, full: true, minWidth: 170, render: (r, c) => once(!c.sameComponent, r.function_focus || dash) },
  { title: "Funktion / Anforderung Merkmal", group: "funktion", compact: false, full: true, minWidth: 170, className: "small", render: (r) => r.function_lower },
  { title: "Fehlerfolge (FE)", group: "fehler", compact: true, full: true, minWidth: 200, render: (r, c) => once(!c.sameMode, r.failure_effect) },
  { title: "B", group: "fehler", compact: true, full: true, className: "rating", render: (r) => r.severity },
  { title: "Fehlerart (FM)", group: "fehler", compact: true, full: true, minWidth: 130, render: (r, c) => once(!c.sameMode, <strong>{r.failure_mode}</strong>) },
  { title: "Fehlerursache (FC)", group: "fehler", compact: true, full: true, minWidth: 200, render: (r) => r.failure_cause },
  { title: "Vermeidungsmaßnahmen (PC)", group: "risiko", compact: true, full: true, className: "controls", render: (r, c) => <Controls text={r.prevention_controls} extent={c.full} /> },
  { title: "A", group: "risiko", compact: true, full: true, className: "rating", render: (r) => r.occurrence },
  { title: "Entdeckungsmaßnahmen (DC)", group: "risiko", compact: true, full: true, className: "controls", render: (r, c) => <Controls text={r.detection_controls} extent={c.full} /> },
  { title: "E", group: "risiko", compact: true, full: true, className: "rating", render: (r) => r.detection },
  { title: "AP", group: "risiko", compact: true, full: true, className: "center", render: (r) => <ApBadge ap={r.action_priority} /> },
  {
    title: "Bes. Merkmal",
    group: "risiko",
    compact: true,
    full: true,
    className: "center",
    render: (r) => r.special_characteristic && <span className={`badge sc sc-${r.special_characteristic.slice(2)}`}>{r.special_characteristic}</span>,
  },
  { title: "RPZ", group: "risiko", compact: false, full: true, className: "center muted", render: (r) => r.rpn },
  {
    title: "Optimierungsmaßnahmen",
    group: "optimierung",
    compact: true,
    full: false,
    className: "controls",
    render: (r) => (r.opt_prevention || r.opt_detection ? <Controls text={[r.opt_prevention, r.opt_detection].filter(Boolean).join("\n")} /> : dash),
  },
  { title: "Vermeidungsmaßnahme", group: "optimierung", compact: false, full: true, className: "controls", render: (r) => <Controls text={r.opt_prevention} /> },
  { title: "Entdeckungsmaßnahme", group: "optimierung", compact: false, full: true, className: "controls", render: (r) => <Controls text={r.opt_detection} /> },
  {
    title: "Verantwortlich / Termin",
    group: "optimierung",
    compact: true,
    full: true,
    minWidth: 120,
    render: (r) => (
      <>
        {r.opt_responsible || dash}
        {r.opt_target_date && <div className="muted small">{r.opt_target_date}</div>}
        {r.opt_status && <div className="small">{r.opt_status}</div>}
      </>
    ),
  },
  {
    title: "A / E neu",
    group: "optimierung",
    compact: false,
    full: true,
    className: "center",
    render: (r) => (r.opt_occurrence || r.opt_detection_rating ? `${r.opt_occurrence ?? "–"} / ${r.opt_detection_rating ?? "–"}` : "–"),
  },
  { title: "AP neu", group: "optimierung", compact: true, full: true, className: "center", render: (r) => (r.opt_action_priority ? <ApBadge ap={r.opt_action_priority} /> : "–") },
  { title: "Bemerkungen", group: "optimierung", compact: false, full: true, minWidth: 180, className: "small", render: (r) => r.remarks },
];

export function FmeaTable({ rows, onSelect }: { rows: FmeaRow[]; onSelect: (row: FmeaRow) => void }) {
  const [ap, setAp] = useState("");
  const [component, setComponent] = useState("");
  const [search, setSearch] = useState("");
  const [full, setFull] = useState(false);

  const components = useMemo(() => [...new Set(rows.map((r) => r.focus_element))], [rows]);
  const filtered = rows.filter(
    (r) =>
      (!ap || r.action_priority === ap) &&
      (!component || r.focus_element === component) &&
      (!search ||
        `${r.failure_mode} ${r.failure_cause} ${r.prevention_controls} ${r.detection_controls} ${r.lower_level}`.toLowerCase().includes(search.toLowerCase())),
  );
  const columns = COLUMNS.filter((c) => (full ? c.full : c.compact));
  const groups: { group: Group; span: number }[] = [];
  columns.forEach((c) => {
    const last = groups[groups.length - 1];
    if (last && last.group === c.group) last.span += 1;
    else groups.push({ group: c.group, span: 1 });
  });

  return (
    <>
      <div className="filters" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="segmented" role="radiogroup" aria-label="Ansicht">
          <button className={!full ? "active" : ""} onClick={() => setFull(false)} aria-pressed={!full}>
            Kompakt
          </button>
          <button className={full ? "active" : ""} onClick={() => setFull(true)} aria-pressed={full}>
            AIAG-VDA vollständig
          </button>
        </div>
        <select value={component} onChange={(e) => setComponent(e.target.value)} aria-label="Bauteil filtern">
          <option value="">Alle Bauteile</option>
          {components.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={ap} onChange={(e) => setAp(e.target.value)} aria-label="Aufgabenpriorität filtern">
          <option value="">Alle AP</option>
          <option value="H">AP Hoch</option>
          <option value="M">AP Mittel</option>
          <option value="L">AP Niedrig</option>
        </select>
        <input type="search" placeholder="Suche in Fehlerart, Ursache, Maßnahmen …" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 260 }} />
        <span className="muted small">
          {filtered.length} von {rows.length} Zeilen · Zeile anklicken zum Öffnen
        </span>
      </div>
      {filtered.length === 0 ? (
        <Empty>Keine Zeilen für diesen Filter.</Empty>
      ) : (
        <div className="fmea-scroll">
          <table className={`fmea-table${full ? " full" : ""}`}>
            <thead>
              <tr>
                {groups.map(({ group, span }, i) => (
                  <th key={`${group}-${i}`} colSpan={span} className={`grp-${group}`}>
                    {GROUP_TITLES[group]}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((c) => (
                  <th key={c.title} className={`grp-${c.group}`}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const prev = filtered[i - 1];
                const ctx: Ctx = {
                  index: rows.indexOf(r) + 1,
                  full,
                  sameComponent: !!prev && prev.component_id === r.component_id,
                  sameMode: !!prev && prev.component_id === r.component_id && prev.failure_mode === r.failure_mode,
                };
                const rowClass = [
                  "clickable",
                  r.manually_edited ? "edited" : "",
                  !ctx.sameComponent ? "group-start" : !ctx.sameMode ? "mode-start" : "",
                ].join(" ");
                return (
                  <tr key={r.id} className={rowClass} onClick={() => onSelect(r)} title={r.manually_edited ? "Manuell bearbeitet" : undefined}>
                    {columns.map((c) => (
                      <td key={c.title} className={c.className} style={c.minWidth ? { minWidth: c.minWidth } : undefined}>
                        {c.render(r, ctx)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
