import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, download, errorText } from "../api";
import { useAuth } from "../auth";
import { FmeaTable } from "../components/fmea/FmeaTable";
import { CompareTab, HistoryTab, RequirementsTab, TraceabilityTab } from "../components/fmea/FmeaTabs";
import { RowDialog } from "../components/fmea/RowDialog";
import { ApBadge, Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Stat, StatusBadge, Tabs, useConfirm } from "../components/ui";
import { fmtDateTime } from "../format";
import { useAction, useResource } from "../hooks";
import type { FmeaDetail, FmeaRow } from "../types";

type Tab = "blatt" | "anforderungen" | "rueckverfolgbarkeit" | "historie" | "vergleich";

function DecisionDialog({
  kind,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  kind: "approve" | "reject";
  onClose: () => void;
  onConfirm: (comment: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [comment, setComment] = useState("");
  const approve = kind === "approve";
  return (
    <Modal
      title={approve ? "FMEA freigeben" : "FMEA zurückweisen"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant={approve ? "primary" : "danger"} onClick={() => onConfirm(comment)} busy={busy} disabled={!approve && !comment.trim()}>
            {approve ? "Freigeben" : "Zurückweisen"}
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p style={{ marginTop: 0 }} className="muted">
        {approve
          ? "Mit der Freigabe wird die FMEA schreibgeschützt; eine bisher freigegebene Version derselben Baugruppe wird als „ersetzt“ markiert."
          : "Die FMEA geht mit Ihrem Kommentar zur Überarbeitung an den Konstrukteur zurück."}
      </p>
      <Field label={approve ? "Kommentar (optional)" : "Begründung"} required={!approve}>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} autoFocus />
      </Field>
    </Modal>
  );
}

function HeaderDialog({ doc, onClose, onSaved }: { doc: FmeaDetail; onClose: () => void; onSaved: (d: FmeaDetail) => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ title: doc.title, team: doc.team, responsible: doc.responsible, confidentiality: doc.confidentiality });
  const submit = async () => {
    const saved = await run(() => api.put<FmeaDetail>(`/api/fmea/${doc.id}`, form));
    if (saved) onSaved(saved);
  };
  return (
    <Modal
      title="Kopfdaten (Planung & Vorbereitung)"
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
      <Field label="Titel">
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Funktionsübergreifendes Team">
        <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Konstruktionsverantwortung">
          <input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} />
        </Field>
        <Field label="Vertraulichkeit">
          <input value={form.confidentiality} onChange={(e) => setForm({ ...form, confidentiality: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function FmeaDetailPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { data: doc, error, loading, setData, reload } = useResource<FmeaDetail>(`/api/fmea/${id}`);
  const action = useAction();
  const [tab, setTab] = useState<Tab>("blatt");
  const [selected, setSelected] = useState<FmeaRow | null>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | "header" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !doc) return <Loading />;
  if (!doc) return <ErrorBox error={error ?? "FMEA nicht gefunden"} />;

  const isDraft = doc.status === "entwurf" || doc.status === "abgelehnt";
  const designer = hasRole("konstrukteur", "admin");
  const reviewer = hasRole("pruefer", "admin");
  const rowsEditable = (isDraft && designer) || (doc.status === "in_pruefung" && reviewer);
  const ownDocument = doc.created_by_id === user?.id;
  const counts = { H: 0, M: 0, L: 0 } as Record<"H" | "M" | "L", number>;
  doc.rows.forEach((r) => (counts[r.action_priority] += 1));
  const openHigh = doc.rows.filter((r) => r.action_priority === "H" && !r.opt_responsible.trim()).length;

  const transition = async (path: string, body?: unknown, message?: string) => {
    const result = await action.run(() => api.post<FmeaDetail>(`/api/fmea/${doc.id}/${path}`, body));
    if (result) {
      setData(result);
      setDialog(null);
      if (message) setNotice(message);
    }
  };

  const regenerate = async () => {
    const result = await action.run(() =>
      api.post<FmeaDetail>(`/api/assemblies/${doc.assembly_id}/fmea/generate`, {
        title: doc.title,
        team: doc.team,
        responsible: doc.responsible,
        confidentiality: doc.confidentiality,
      }),
    );
    if (result) navigate(`/fmea/${result.id}`);
  };

  const remove = async () => {
    if (!(await confirm(`Entwurf ${doc.fmea_number} V${doc.version} löschen?`))) return;
    const ok = await action.run(async () => {
      await api.del(`/api/fmea/${doc.id}`);
      return true;
    });
    if (ok) navigate(`/baugruppen/${doc.assembly_id}`);
  };

  const exportFile = async (fmt: "xlsx" | "pdf") => {
    try {
      await download(`/api/fmea/${doc.id}/export.${fmt}`, `${doc.fmea_number}_V${doc.version}.${fmt}`);
    } catch (err) {
      action.setError(errorText(err));
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/fmea">FMEA-Dokumente</Link> / <Link to={`/baugruppen/${doc.assembly_id}`}>{doc.assembly_drawing_number} {doc.assembly_name}</Link>
          </>
        }
        title={
          <span className="row">
            <span className="mono">{doc.fmea_number}</span> <span>Version {doc.version}</span> <StatusBadge status={doc.status} />
          </span>
        }
        subtitle={doc.title}
        actions={
          <>
            <Button onClick={() => exportFile("xlsx")}>Excel</Button>
            <Button onClick={() => exportFile("pdf")}>PDF</Button>
            {isDraft && designer && (
              <>
                <Button onClick={() => setDialog("header")}>Kopfdaten</Button>
                {(ownDocument || hasRole("admin")) && (
                  <Button variant="danger" onClick={remove}>
                    Löschen
                  </Button>
                )}
                <Button variant="primary" onClick={() => transition("submit", undefined, "Die FMEA wurde zur Prüfung eingereicht.")} busy={action.busy}>
                  Zur Prüfung einreichen
                </Button>
              </>
            )}
            {doc.status === "in_pruefung" && reviewer && (
              <>
                <Button variant="danger" onClick={() => setDialog("reject")}>
                  Zurückweisen
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setDialog("approve")}
                  disabled={ownDocument}
                  title={ownDocument ? "Vier-Augen-Prinzip: eigene FMEA kann nicht freigegeben werden" : undefined}
                >
                  Freigeben
                </Button>
              </>
            )}
            {doc.status === "freigegeben" && (
              <Button variant="primary" onClick={() => transition(
                    "pdm-store",
                    undefined,
                    __STANDALONE__
                      ? "Ablage im Demo-PDM vermerkt. Die Browser-Version hat keine echte PDM-Anbindung – Excel und PDF bitte über die Export-Schaltflächen sichern."
                      : "Excel- und PDF-Dokument wurden im PDM gespeichert.",
                  )} busy={action.busy}>
                {doc.pdm_status === "gespeichert" ? "Erneut im PDM speichern" : "Im PDM speichern"}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={action.error} onClose={() => action.setError(null)} />
      {notice && <Notice kind="success">{notice}</Notice>}
      {doc.status === "abgelehnt" && doc.review_comment && (
        <Notice kind="warning">
          <strong>Zurückgewiesen von {doc.reviewed_by}</strong> ({fmtDateTime(doc.reviewed_at)}): {doc.review_comment}
        </Notice>
      )}
      {doc.outdated_components.length > 0 && (
        <Notice kind="warning">
          <div className="row">
            <span>
              Seit der Generierung wurden Klassifikationen geändert: {doc.outdated_components.join(", ")}.
            </span>
            {designer && (
              <Button size="sm" onClick={regenerate} busy={action.busy}>
                Neue Version generieren
              </Button>
            )}
          </div>
        </Notice>
      )}
      {doc.status === "in_pruefung" && openHigh > 0 && (
        <Notice kind="warning">
          {openHigh} Zeile(n) mit Aufgabenpriorität H haben noch keinen Verantwortlichen für die Optimierung – Voraussetzung für die Freigabe.
        </Notice>
      )}
      {doc.warnings.length > 0 && (
        <Notice kind="info">
          <strong>Hinweise der Generierung</strong>
          <ul>
            {doc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="FMEA-Zeilen" value={doc.rows.length} hint={<span className="muted">{doc.snapshot.components?.length ?? 0} Bauteile</span>} />
        <Stat
          label="Aufgabenpriorität"
          value={
            <span className="row">
              <ApBadge ap="H" /> {counts.H} <ApBadge ap="M" /> {counts.M} <ApBadge ap="L" /> {counts.L}
            </span>
          }
        />
        <Stat label="Anforderungen (Halbzeug / Bauteil)" value={`${doc.requirements.filter((r) => r.scope === "halbzeug").length} / ${doc.requirements.filter((r) => r.scope === "bauteil").length}`} />
        <Stat
          label="Status"
          value={<StatusBadge status={doc.status} />}
          hint={
            <span className="muted small">
              Erstellt {doc.created_by}, {fmtDateTime(doc.created_at)}
              {doc.reviewed_by && (
                <>
                  <br />
                  Geprüft {doc.reviewed_by}, {fmtDateTime(doc.reviewed_at)}
                </>
              )}
              {doc.pdm_status && (
                <>
                  <br />
                  PDM: {doc.pdm_status} {doc.pdm_synced_at && `(${fmtDateTime(doc.pdm_synced_at)})`}
                </>
              )}
            </span>
          }
        />
      </div>

      <Tabs<Tab>
        tabs={[
          { id: "blatt", label: "FMEA-Formblatt" },
          { id: "anforderungen", label: `Anforderungen (${doc.requirements.length})` },
          { id: "rueckverfolgbarkeit", label: "Rückverfolgbarkeit" },
          { id: "historie", label: "Historie" },
          { id: "vergleich", label: "Versionsvergleich" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "blatt" && (
        <Card
          title="Design-FMEA nach AIAG & VDA"
          actions={<span className="muted small">{rowsEditable ? "Bearbeitbar – Zeile anklicken" : "Schreibgeschützt"} · Team: {doc.team || "–"} · Verantwortlich: {doc.responsible || "–"}</span>}
          flush
        >
          <FmeaTable rows={doc.rows} onSelect={setSelected} />
        </Card>
      )}
      {tab === "anforderungen" && <RequirementsTab doc={doc} />}
      {tab === "rueckverfolgbarkeit" && <TraceabilityTab doc={doc} />}
      {tab === "historie" && <HistoryTab fmeaId={doc.id} />}
      {tab === "vergleich" && <CompareTab doc={doc} />}

      {selected && (
        <RowDialog
          fmeaId={doc.id}
          row={selected}
          editable={rowsEditable}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void reload();
          }}
        />
      )}
      {(dialog === "approve" || dialog === "reject") && (
        <DecisionDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          busy={action.busy}
          error={action.error}
          onConfirm={(comment) =>
            transition(dialog, { comment }, dialog === "approve" ? "Die FMEA wurde freigegeben." : "Die FMEA wurde zurückgewiesen.")
          }
        />
      )}
      {dialog === "header" && (
        <HeaderDialog
          doc={doc}
          onClose={() => setDialog(null)}
          onSaved={(d) => {
            setData(d);
            setDialog(null);
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}
