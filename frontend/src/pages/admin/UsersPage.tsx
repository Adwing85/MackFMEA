import { useState } from "react";
import { api } from "../../api";
import { ROLE_LABELS, useAuth } from "../../auth";
import { Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader } from "../../components/ui";
import { useAction, useResource } from "../../hooks";
import type { Role, User } from "../../types";

const ROLE_HELP: Record<Role, string> = {
  konstrukteur: "Baugruppen anlegen, Bauteile klassifizieren, FMEA generieren und einreichen",
  pruefer: "FMEAs prüfen, freigeben oder zurückweisen; Auditlog einsehen",
  admin: "Werknormen, Regeltabellen, Schlüsseltabelle, Maßnahmenkatalog und Benutzer pflegen",
};

function UserDialog({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({
    username: user?.username ?? "",
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? ("konstrukteur" as Role),
    is_active: user?.is_active ?? true,
    password: "",
  });
  const submit = async () => {
    const { username, password, ...rest } = form;
    const ok = await run(() =>
      user
        ? api.put(`/api/users/${user.id}`, { ...rest, ...(password ? { password } : {}) })
        : api.post("/api/users", { username, password, full_name: rest.full_name, email: rest.email, role: rest.role }),
    );
    if (ok) onSaved();
  };
  return (
    <Modal
      title={user ? `Benutzer ${user.username}` : "Neuer Benutzer"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!form.username || (!__STANDALONE__ && !user && form.password.length < 8)}>
            Speichern
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Benutzername" required>
          <input value={form.username} disabled={!!user} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Name">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="E-Mail">
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Rolle" hint={ROLE_HELP[form.role]}>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {!__STANDALONE__ && (
          <Field label={user ? "Neues Passwort" : "Passwort"} required={!user} hint={user ? "leer lassen = unverändert" : "mindestens 8 Zeichen"} className="full">
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
        )}
      </div>
      {user && (
        <label className="checkbox">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> aktiv
        </label>
      )}
    </Modal>
  );
}

export function UsersPage() {
  const { hasRole } = useAuth();
  const { data, error, loading, reload } = useResource<User[]>(hasRole("admin") ? "/api/users" : null);
  const [editing, setEditing] = useState<User | null | "new">(null);

  if (!hasRole("admin")) return <Notice kind="warning">Nur für Administratoren.</Notice>;

  return (
    <>
      <PageHeader title="Benutzer" subtitle="Rollen: Konstrukteur (Eingabe), Prüfer (Review), Admin (Norm- und Katalogpflege)" actions={<Button variant="primary" onClick={() => setEditing("new")}>+ Benutzer</Button>} />
      <ErrorBox error={error} />
      <Card>
        {loading && !data ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Benutzername</th>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.username}</td>
                  <td>{u.full_name}</td>
                  <td>{u.email || "–"}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.is_active ? "aktiv" : <span className="muted">deaktiviert</span>}</td>
                  <td className="actions">
                    <Button size="sm" onClick={() => setEditing(u)}>
                      Bearbeiten
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && (
        <UserDialog
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
