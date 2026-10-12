'use client';

import { useEffect, useRef } from 'react';

/* Button ------------------------------------------------------------------ */
type ButtonVariant = 'primary' | 'danger' | 'ghost';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const cls =
    variant === 'primary'
      ? 'btn btn-primary'
      : variant === 'danger'
        ? 'btn btn-danger'
        : 'btn btn-ghost';
  return <button className={(cls + ' ' + className).trim()} {...props} />;
}

/* Inputs ------------------------------------------------------------------ */
export function TextInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={('input ' + className).trim()} {...props} />;
}

export function TextArea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={('input ' + className).trim()} {...props} />;
}

export function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={('input ' + className).trim()} {...props}>
      {children}
    </select>
  );
}

/* Card -------------------------------------------------------------------- */
export function Card({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={('card ' + className).trim()} {...props}>
      {children}
    </div>
  );
}

/* Badge ------------------------------------------------------------------- */
type BadgeTone = 'gold' | 'teal' | 'red' | 'green' | 'neutral';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  gold: 'badge b-gold',
  teal: 'badge b-teal',
  red: 'badge b-red',
  green: 'badge b-green',
  neutral: 'badge',
};

export function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={(BADGE_CLASSES[tone] + ' ' + className).trim()} {...props}>
      {children}
    </span>
  );
}

/* Field (label + input wrapper) -------------------------------------------- */
export function Field({
  label,
  htmlFor,
  error,
  className = '',
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={('field-row ' + className).trim()}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/* Modal -------------------------------------------------------------------- */
export function Modal({
  title,
  onClose,
  className = '',
  children,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);

    // Focus the first focusable element (focus trap-ish).
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (first ?? dialog)?.focus();

    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={'card ' + className}
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="section-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* Toast -------------------------------------------------------------------- */
type ToastTone = 'info' | 'success' | 'error';

export function Toast({
  message,
  tone = 'info',
}: {
  message: string | null;
  tone?: ToastTone;
}) {
  if (!message) return null;
  const toneClass = tone === 'error' ? ' toast-error' : tone === 'success' ? ' toast-success' : '';
  return (
    <div className={'toast' + toneClass} role="status">
      {message}
    </div>
  );
}

/* EmptyState --------------------------------------------------------------- */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3 className="section-title" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      {body && <p>{body}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
