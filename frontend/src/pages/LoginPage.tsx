import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { errorText } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorBox, Field } from "../components/ui";

const DEMO = [
  ["konstrukteur", "Konstrukteur – Eingabe & Klassifikation"],
  ["pruefer", "Prüfer – Review & Freigabe"],
  ["admin", "Admin – Norm- & Katalogpflege"],
];

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

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
