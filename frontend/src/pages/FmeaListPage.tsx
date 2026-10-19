import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApBadge, Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import { fmtDateTime, STATUS_LABELS } from "../format";
import { useResource } from "../hooks";
import type { FmeaStatus, FmeaSummary } from "../types";

export function FmeaListPage({ reviewQueue = false }: { reviewQueue?: boolean }) {
  const [status, setStatus] = useState<string>("");
  const effective = reviewQueue ? "in_pruefung" : status;
  const { data, error, loading } = useResource<FmeaSummary[]>(`/api/fmea${effective ? `?status=${effective}` : ""}`);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={reviewQueue ? "Prüfungen" : "FMEA-Dokumente"}
        subtitle={reviewQueue ? "Zur Prüfung eingereichte FMEAs (Vier-Augen-Prinzip)" : "Alle generierten FMEA-Versionen"}
      />
      <ErrorBox error={error} />
      <Card
        title={reviewQueue ? "Warten auf Prüfung" : "Dokumente"}
        actions={
          !reviewQueue && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
              <option value="">Alle Status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )
        }
      >
        {loading && !data ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty>{reviewQueue ? "Aktuell sind keine FMEAs zur Prüfung eingereicht." : "Keine FMEA-Dokumente vorhanden."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>FMEA-Nr.</th>
                  <th>Version</th>
                  <th>Baugruppe</th>
                  <th>Status</th>
                  <th>Zeilen</th>
                  <th>AP H / M / L</th>
                  <th>Erstellt</th>
                  <th>Geprüft</th>
                </tr>
              </thead>
              <tbody>
                {data.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => navigate(`/fmea/${f.id}`)}>
                    <td className="mono">
                      <Link to={`/fmea/${f.id}`}>{f.fmea_number}</Link>
                    </td>
                    <td>V{f.version}</td>
                    <td>
                      <span className="mono">{f.assembly_drawing_number}</span> {f.assembly_name}
                    </td>
                    <td>
                      <StatusBadge status={f.status as FmeaStatus} />
                    </td>
                    <td>{f.rows}</td>
                    <td className="nowrap">
                      <ApBadge ap="H" /> {f.ap_counts.H} <ApBadge ap="M" /> {f.ap_counts.M} <ApBadge ap="L" /> {f.ap_counts.L}
                    </td>
                    <td className="small">
                      {f.created_by}
                      <div className="muted">{fmtDateTime(f.created_at)}</div>
                    </td>
                    <td className="small">{f.reviewed_by || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
