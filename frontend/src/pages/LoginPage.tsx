import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { errorText } from "../api";
import { ROLE_LABELS, useAuth } from "../auth";
import { Button, ErrorBox, Field, Loading } from "../components/ui";
import { useResource } from "../hooks";
import type { Role } from "../types";

const DEMO = [
  ["konstrukteur", "Konstrukteur – Eingabe & Klassifikation"],
  ["pruefer", "Prüfer – Review & Freigabe"],
  ["admin", "Admin – Norm- & Katalogpflege"],
];

/** Browser-Version: Anmeldung durch Auswahl des Benutzers (ohne Passwort). */
function UserPicker() {
  const { login } = useAuth();
  const users = useResource<{ username: string; full_name: string; role: Role }[]>("/api/auth/login-users");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (username: string) => {
    setBusy(username);
    setError(null);
    try {
      await login(username, "");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ErrorBox error={error ?? users.error} />
      {users.loading && !users.data && <Loading />}
      <div className="stack" style={{ gap: 8 }}>
        {users.data?.map((u) => (
          <Button key={u.username} onClick={() => pick(u.username)} busy={busy === u.username} className="w-full user-pick">
            <span>{u.full_name || u.username}</span>
            <span className="muted small">{ROLE_LABELS[u.role]}</span>
          </Button>
        ))}
      </div>
      <p className="demo-users">
        In der Browser-Version wählen Sie, in welcher Rolle Sie arbeiten. Der Zugriff auf die Daten wird über die Freigabe dieser Seite
        gesteuert; Benutzer und Rollen pflegt der Admin unter „Benutzer“.
      </p>
    </>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  if (__STANDALONE__) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>MackFMEA</h1>
          <p>Automatisierte FMEA-Erstellung auf Basis der Bauteilklassifikation</p>
          <UserPicker />
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>MackFMEA</h1>
        <p>Automatisierte FMEA-Erstellung auf Basis der Bauteilklassifikation</p>
        <ErrorBox error={error} />
        <Field label="Benutzername">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </Field>
        <Field label="Passwort">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Button variant="primary" type="submit" busy={busy} disabled={!username || !password} className="w-full">
          Anmelden
        </Button>
        <div className="demo-users">
          Demo-Zugänge (Benutzername = Passwort):
          {DEMO.map(([name, label]) => (
            <div key={name}>
              <button
                type="button"
                onClick={() => {
                  setUsername(name);
                  setPassword(name);
                }}
              >
                {name}
              </button>{" "}
              – {label}
            </div>
          ))}
        </div>
      </form>
    </div>
  );
}
