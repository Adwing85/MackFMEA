import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api, errorText } from "../api";
import { ROLE_LABELS, useAuth } from "../auth";
import { Icon } from "./Icon";
import { Button, ErrorBox, Field, Modal, Notice } from "./ui";

function Item({ to, icon, label, end }: { to: string; icon: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
      <span className="nav-icon">
        <Icon name={icon} />
      </span>
      {label}
    </NavLink>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    try {
      await api.post("/api/auth/change-password", { current_password: current, new_password: next });
      setDone(true);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal
      title="Passwort ändern"
      onClose={onClose}
      footer={
        done ? (
          <Button onClick={onClose}>Schließen</Button>
        ) : (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={submit} disabled={!current || next.length < 8}>
              Speichern
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice kind="success">Das Passwort wurde geändert.</Notice>
      ) : (
        <>
          <ErrorBox error={error} />
          <Field label="Aktuelles Passwort">
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </Field>
          <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}

export function Layout() {
  const { user, logout, hasRole } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">FM</div>
          <div>
            MackFMEA
            <small>Automatisierte DFMEA</small>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-section">Arbeitsbereich</div>
          <Item to="/" end icon="dashboard" label="Übersicht" />
          <Item to="/baugruppen" icon="assembly" label="Baugruppen & Klassifikation" />
          <Item to="/fmea" end icon="fmea" label="FMEA-Dokumente" />
          {hasRole("pruefer", "admin") && <Item to="/fmea/pruefung" icon="review" label="Prüfungen" />}
          <div className="nav-section">Regelwerk</div>
          <Item to="/regelwerk/sc-klassen" icon="sc" label="SC-Klassen" />
          <Item to="/regelwerk/merkmale" icon="list" label="Merkmalslisten" />
          <Item to="/regelwerk/werknormen" icon="book" label="Werknormen" />
          <Item to="/regelwerk/anforderungen" icon="rules" label="Anforderungsregeln" />
          <Item to="/regelwerk/massnahmen" icon="tool" label="Maßnahmenkatalog" />
          <Item to="/regelwerk/schluessel" icon="key" label="Schlüsseltabelle" />
          {hasRole("pruefer", "admin") && (
            <>
              <div className="nav-section">System</div>
              <Item to="/audit" icon="audit" label="Auditlog" />
            </>
          )}
          {hasRole("admin") && <Item to="/benutzer" icon="users" label="Benutzer" />}
        </nav>
        <div className="sidebar-footer">
          <div className="user-name">{user.full_name || user.username}</div>
          <div>{ROLE_LABELS[user.role]}</div>
          <div className="row">
            <button onClick={() => setPwOpen(true)}>Passwort</button>
            <button onClick={logout}>Abmelden</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </div>
  );
}
