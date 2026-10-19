import { useEffect, useState, type ReactNode } from "react";
import { Button, Loading, Notice } from "../components/ui";
import { persistence, status } from "./persistence";
import { recordSeed } from "./server";

type Phase = "loading" | "empty" | "ready" | "error";

/** Lädt den Datenbestand (gemeinsame Datenbank oder Browser-Speicher), bevor die App startet. */
export function Gate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    persistence
      .init()
      .then(({ empty }) => {
        if (cancelled) return;
        if (empty && persistence.mode === "local") {
          persistence.seed(recordSeed); // lokal: ohne Rückfrage mit Musterdaten starten
          setPhase("ready");
        } else {
          setPhase(empty ? "empty" : "ready");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? String(err?.code ?? err));
        setPhase("error");
      });
    const onStatus = () => setTick((t) => t + 1);
    window.addEventListener("mackfmea:status", onStatus);
    return () => {
      cancelled = true;
      window.removeEventListener("mackfmea:status", onStatus);
    };
  }, []);

  if (phase === "loading") return <Loading label="Datenbestand wird geladen …" />;
  if (phase === "error")
    return (
      <div className="gate-card">
        <Notice kind="warning">Der Datenbestand konnte nicht geladen werden: {error}</Notice>
      </div>
    );
  if (phase === "empty")
    return (
      <div className="gate-card">
        <h1>MackFMEA einrichten</h1>
        <p>
          Der gemeinsame Datenbestand dieser Seite ist noch leer. Er wird mit dem Musterregelwerk (SC-Klassen, Merkmalslisten,
          Musterwerknormen, Anforderungsregeln, Maßnahmenkatalog, Schlüsseltabelle), drei Demo-Benutzern und der Demo-Baugruppe
          BG-200100 angelegt. Alle, die diese Seite öffnen, arbeiten danach mit denselben Daten.
        </p>
        {persistence.canWrite === false ? (
          <Notice kind="warning">Ihre Freigabestufe erlaubt keine Änderungen. Bitte die Person fragen, die die Seite geteilt hat.</Notice>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              persistence.seed(recordSeed);
              setPhase("ready");
            }}
          >
            Datenbestand anlegen
          </Button>
        )}
      </div>
    );

  const message = status.storageError
    ? status.storageError
    : status.readOnly
      ? "Nur-Lese-Zugriff: Sie sehen den gemeinsamen Datenbestand, können ihn aber nicht ändern."
      : status.mode === "shared"
        ? "Browser-Version · gemeinsamer Datenbestand: Alle mit Zugriff auf diese Seite sehen dieselben Daten."
        : "Browser-Version · Daten werden nur in diesem Browser gespeichert.";
  return (
    <div className="with-bar">
      <div className={`standalone-bar${status.readOnly || status.storageError ? " warn" : ""}`} role="status" title={message}>
        {message}
      </div>
      {children}
    </div>
  );
}
