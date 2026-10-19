import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Tabs } from "../components/ui";
import { fmtDate } from "../format";
import { useAction, useDebounced, useResource } from "../hooks";
import type { Assembly, AssemblyDetail, PdmItem } from "../types";

type Mode = "pdm" | "datei" | "manuell";

function CreateDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("pdm");
  const { busy, error, run } = useAction();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const pdmStatus = useResource<{ connector: string; connected: boolean; message: string }>("/api/pdm/status");
  const search = useResource<PdmItem[]>(mode === "pdm" ? `/api/pdm/search?q=${encodeURIComponent(debounced)}` : null);
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ drawing_number: "", name: "", revision: "", function: "" });

  const done = (assembly: AssemblyDetail | undefined) => {
    if (assembly) navigate(`/baugruppen/${assembly.id}`);
  };

  const submit = async () => {
    if (mode === "pdm") {
      done(await run(() => api.post<AssemblyDetail>("/api/pdm/import", { drawing_number: selected, function: meta.function })));
    } else if (mode === "datei" && file) {
      const form = new FormData();
      form.append("file", file);
      Object.entries(meta).forEach(([k, v]) => form.append(k, v));
      done(await run(() => api.upload<AssemblyDetail>("/api/assemblies/import", form)));
    } else {
      done(await run(() => api.post<AssemblyDetail>("/api/assemblies", { ...meta, components: [] })));
    }
  };

  const canSubmit = mode === "pdm" ? !!selected : mode === "datei" ? !!file : !!meta.drawing_number && !!meta.name;
  const set = (key: keyof typeof meta) => (e: { target: { value: string } }) => setMeta({ ...meta, [key]: e.target.value });

  return (
    <Modal
      title="Baugruppe anlegen"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!canSubmit}>
            {mode === "pdm" ? "Aus PDM übernehmen" : mode === "datei" ? "Importieren" : "Anlegen"}
          </Button>
        </>
      }
    >
      <Tabs<Mode>
        tabs={[
          { id: "pdm", label: "Aus PDM (Keytech)" },
          { id: "datei", label: "Stücklisten-Datei (CSV/XML)" },
          { id: "manuell", label: "Manuell" },
        ]}
        active={mode}
        onChange={setMode}
      />
      <ErrorBox error={error} />
      {mode === "pdm" && (
        <>
          {pdmStatus.data && (
            <Notice kind={pdmStatus.data.connected ? "info" : "warning"}>
              PDM-Konnektor <strong>{pdmStatus.data.connector}</strong>: {pdmStatus.data.message}
            </Notice>
          )}
          <Field label="Zeichnungsnummer / Benennung suchen">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="z. B. BG-300100" />
          </Field>
          <ErrorBox error={search.error} />
          <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Zeichnungsnr.</th>
                  <th>Benennung</th>
                  <th>Rev.</th>
                  <th>Material</th>
                </tr>
              </thead>
              <tbody>
                {(search.data ?? []).map((item) => (
                  <tr key={item.number} className="clickable" onClick={() => setSelected(item.number)}>
                    <td>
                      <input type="radio" checked={selected === item.number} onChange={() => setSelected(item.number)} />
                    </td>
                    <td className="mono">{item.number}</td>
                    <td>
                      {item.name}
                      {item.name2 && <div className="muted small">{item.name2}</div>}
                    </td>
                    <td>{item.revision}</td>
                    <td className="small">{item.material}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Die Stückliste der gewählten Baugruppe wird mit allen Ebenen übernommen.</p>
          <Field label="Funktion der Baugruppe (optional)">
            <input value={meta.function} onChange={set("function")} />
          </Field>
        </>
      )}
      {mode === "datei" && (
        <>
          <Field
            label="Stücklisten-Datei"
            hint="CSV (Trennzeichen ; , oder Tab) oder XML. Erkannt werden u. a. die Spalten des Inventor-Stücklistenexports: Pos., Bauteilnummer, Beschreibung, Menge, Material."
            required
          >
            <input type="file" accept=".csv,.txt,.xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <div className="form-grid">
            <Field label="Zeichnungsnummer" hint="leer = aus Datei bzw. Dateiname">
              <input value={meta.drawing_number} onChange={set("drawing_number")} />
            </Field>
            <Field label="Benennung" hint="leer = aus Datei bzw. Dateiname">
              <input value={meta.name} onChange={set("name")} />
            </Field>
            <Field label="Revision">
              <input value={meta.revision} onChange={set("revision")} />
            </Field>
            <Field label="Funktion der Baugruppe">
              <input value={meta.function} onChange={set("function")} />
            </Field>
          </div>
        </>
      )}
      {mode === "manuell" && (
        <div className="form-grid">
          <Field label="Zeichnungsnummer" required>
            <input value={meta.drawing_number} onChange={set("drawing_number")} />
          </Field>
          <Field label="Benennung" required>
            <input value={meta.name} onChange={set("name")} />
          </Field>
          <Field label="Revision">
            <input value={meta.revision} onChange={set("revision")} />
          </Field>
          <Field label="Funktion der Baugruppe">
            <input value={meta.function} onChange={set("function")} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function AssembliesPage() {
  const { hasRole } = useAuth();
  const { data, error, loading } = useResource<Assembly[]>("/api/assemblies");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();

  const rows = (data ?? []).filter((a) =>
    `${a.drawing_number} ${a.name}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Baugruppen"
        subtitle="Stücklisten aus PDM oder Datei übernehmen und Bauteile klassifizieren"
        actions={
          hasRole("konstrukteur", "admin") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Baugruppe anlegen
            </Button>
          )
        }
      />
      <ErrorBox error={error} />
      <Card
        title="Alle Baugruppen"
        actions={<input type="search" placeholder="Filtern …" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />}
      >
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Noch keine Baugruppen vorhanden.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Zeichnungsnr.</th>
                  <th>Benennung</th>
                  <th>Rev.</th>
                  <th>Quelle</th>
                  <th>Klassifiziert</th>
                  <th>Geändert</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => navigate(`/baugruppen/${a.id}`)}>
                    <td className="mono">
                      <Link to={`/baugruppen/${a.id}`}>{a.drawing_number}</Link>
                    </td>
                    <td>{a.name}</td>
                    <td>{a.revision || "–"}</td>
                    <td className="small">{a.source}</td>
                    <td>
                      <span className={a.classified_count === a.component_count ? "" : "muted"}>
                        {a.classified_count} / {a.component_count}
                      </span>
                    </td>
                    <td className="small muted">{fmtDate(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}
