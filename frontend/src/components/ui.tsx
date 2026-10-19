import { useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AP_LABELS, STATUS_LABELS } from "../format";
import type { AP, FmeaStatus } from "../types";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  size,
  busy,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm"; busy?: boolean }) {
  return (
    <button
      className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <span className="spinner spinner-inline" aria-hidden />}
      {children}
    </button>
  );
}

export function ScBadge({ level, title }: { level: number | null | undefined; title?: string }) {
  if (level === null || level === undefined) return <span className="badge badge-muted">–</span>;
  return (
    <span className={`badge sc sc-${level}`} title={title}>
      SC{level}
    </span>
  );
}

export function ApBadge({ ap }: { ap: AP | string }) {
  if (!ap) return <span className="muted">–</span>;
  return (
    <span className={`badge ap ap-${ap}`} title={`Aufgabenpriorität ${AP_LABELS[ap as AP] ?? ap}`}>
      {ap}
    </span>
  );
}

export function StatusBadge({ status }: { status: FmeaStatus }) {
  return <span className={`badge status status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Card({
  title,
  actions,
  children,
  className = "",
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function ErrorBox({ error, onClose }: { error: string | null | undefined; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <div className="alert-text">
        {error.split("\n").map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {onClose && (
        <button className="alert-close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
      )}
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warning" | "success"; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Loading({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
  className = "",
  group,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  required?: boolean;
  className?: string;
  /** Für Auswahlgruppen aus Buttons: rendert eine Gruppe statt eines <label> (sonst übernimmt der erste Button die Beschriftung). */
  group?: boolean;
}) {
  const id = useId();
  const caption = (
    <span className="field-label" id={`${id}-label`}>
      {label}
      {required && <span className="required"> *</span>}
    </span>
  );
  if (group) {
    return (
      <div className={`field ${className}`} role="group" aria-labelledby={`${id}-label`}>
        {caption}
        {children}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
    );
  }
  return (
    <label className={`field ${className}`}>
      {caption}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          className={`tab${tab.id === active ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function MultilineText({ text }: { text: string }) {
  if (!text) return <span className="muted">–</span>;
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </>
  );
}

/** Bestätigungsdialog im Seitenlayout (ersetzt window.confirm, das in eingebetteten Ansichten blockiert ist). */
export function useConfirm() {
  const [state, setState] = useState<{ message: ReactNode; label: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback(
    (message: ReactNode, label = "Löschen") => new Promise<boolean>((resolve) => setState({ message, label, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = state ? (
    <Modal
      title="Bitte bestätigen"
      onClose={() => close(false)}
      footer={
        <>
          <Button onClick={() => close(false)}>Abbrechen</Button>
          <Button variant="danger" onClick={() => close(true)} autoFocus>
            {state.label}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{state.message}</p>
    </Modal>
  ) : null;
  return { confirm, dialog };
}
