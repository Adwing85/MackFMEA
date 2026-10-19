import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat } from "../components/ui";
import { ACTION_LABELS, fmtDateTime, STATUS_LABELS } from "../format";
import { useResource } from "../hooks";
import type { Dashboard, FmeaStatus } from "../types";

const PROCESS = [
  ["Bauteilklassifikation", "Konstrukteur erfasst Liste 1 (Merkmale) und Liste 2 (Klassifikation inkl. SC-Klasse)"],
  ["Anforderungsableitung", "Regeltabellen leiten Anforderungen an Halbzeug und Bauteil je SC-Klasse ab"],
  ["Schlüsselgenerierung", "Jede Kombination Merkmal + SC-Klasse ergibt einen generischen Code"],
  ["Maßnahmenableitung", "Schlüssel ordnen Prüf- und Sicherungsmaßnahmen aus dem Katalog zu"],
  ["FMEA-Generierung", "Zusammenführung zu einem AIAG-&-VDA-Formblatt mit Aufgabenpriorität"],
  ["Review & PDM", "Vier-Augen-Freigabe, Export (Excel/PDF) und Rückspeicherung ins PDM"],
];

export function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading } = useResource<Dashboard>("/api/dashboard");

  return (
    <>
      <PageHeader title={`Willkommen, ${user?.full_name || user?.username}`} subtitle="Überblick über Klassifikationen und FMEA-Dokumente" />
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Baugruppen" value={data.assemblies} />
            <Stat
              label="Bauteile klassifiziert"
              value={`${data.classified} / ${data.components}`}
              hint={
                <span className="row">
                  {Object.entries(data.sc_distribution).map(([sc, count]) => (
                    <span key={sc} className={`badge sc sc-${sc.slice(2)}`}>
                      {sc}: {count}
                    </span>
                  ))}
                </span>
              }
            />
            <Stat
              label="FMEA-Dokumente"
              value={Object.values(data.fmea_status).reduce((a, b) => a + (b ?? 0), 0)}
              hint={
                <span className="muted">
                  {Object.entries(data.fmea_status)
                    .map(([status, count]) => `${STATUS_LABELS[status as FmeaStatus]}: ${count}`)
                    .join(" · ") || "noch keine"}
                </span>
              }
            />
            <Stat
              label="FMEA-Zeilen nach Aufgabenpriorität"
              value={
                <span className="row">
                  <span className="badge ap ap-H">H {data.action_priority.H}</span>
                  <span className="badge ap ap-M">M {data.action_priority.M}</span>
                  <span className="badge ap ap-L">L {data.action_priority.L}</span>
                </span>
              }
              hint={<span className="muted">ohne ersetzte Versionen</span>}
            />
          </div>

          <Card title="Prozess">
            <div className="process">
              {PROCESS.map(([name, text], idx) => (
                <div className="process-step" key={name}>
                  <div className="num">{idx + 1}</div>
                  <div className="name">{name}</div>
                  <div className="result">{text}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title="Offene Prüfungen">
              {data.pending_reviews.length === 0 ? (
                <Empty>Keine FMEAs in Prüfung.</Empty>
              ) : (
                <table className="table">
                  <tbody>
                    {data.pending_reviews.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link to={`/fmea/${r.id}`}>
                            {r.fmea_number} V{r.version}
                          </Link>
                          <div className="muted small">{r.assembly_name}</div>
                        </td>
                        <td className="right muted small">eingereicht {fmtDateTime(r.submitted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title={user?.role === "konstrukteur" ? "Meine letzten Aktivitäten" : "Letzte Aktivitäten"}>
              {data.recent_activity.length === 0 ? (
                <Empty>Keine Aktivitäten.</Empty>
              ) : (
                <table className="table">
                  <tbody>
                    {data.recent_activity.map((a) => (
                      <tr key={a.id}>
                        <td className="nowrap muted small">{fmtDateTime(a.timestamp)}</td>
                        <td>
                          <strong>{ACTION_LABELS[a.action] ?? a.action}</strong> · {a.summary}
                          <div className="muted small">{a.username}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
