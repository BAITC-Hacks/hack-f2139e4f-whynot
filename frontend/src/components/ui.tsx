import { forwardRef, useId } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertCircle, ArrowRight, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Readiness } from '../types';
import { LEVELS } from '../ui/levels';

export function cx(...items: Array<string | false | null | undefined>) { return items.filter(Boolean).join(' '); }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  size?: 'sm';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', loading, size, children, className, disabled, type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx('button', `button-${variant}`, size && `button-${size}`, className)}>
    {loading && <Loader2 size={16} className="spin" aria-hidden="true" />}{children}
  </button>;
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cx('card', className)} {...props} />; }
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span className={cx('badge', className)} {...props} />; }
export function LevelBadge({ level }: { level: Readiness }) { const item = LEVELS[level] ?? LEVELS.draft; return <Badge className={cx('level-badge', item.className)}><span className="badge-dot" aria-hidden="true" />{item.label}</Badge>; }

type FieldExtras = { label?: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldExtras>(function Input({ label, error, hint, id, className, 'aria-describedby': describedBy, ...props }, ref) {
  const generatedId = useId(); const fieldId = id ?? generatedId; const noteId = `${fieldId}-note`;
  return <div className="form-field">{label && <label className="field-label" htmlFor={fieldId}>{label}{props.required && <span className="required-mark"> *</span>}</label>}<input {...props} ref={ref} id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={cx(describedBy, (error || hint) && noteId) || undefined} className={cx('input', error && 'input-error', className)} />{(error || hint) && <p id={noteId} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}</div>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras & { counter?: boolean | string | number }>(function Textarea({ label, error, hint, counter, id, className, 'aria-describedby': describedBy, ...props }, ref) {
  const generatedId = useId(); const fieldId = id ?? generatedId; const noteId = `${fieldId}-note`;
  const count = typeof props.value === 'string' ? props.value.length : typeof props.defaultValue === 'string' ? props.defaultValue.length : 0;
  return <div className="form-field">{label && <label className="field-label" htmlFor={fieldId}>{label}{props.required && <span className="required-mark"> *</span>}</label>}<textarea rows={4} {...props} ref={ref} id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={cx(describedBy, (error || hint) && noteId) || undefined} className={cx('input', 'textarea', error && 'input-error', className)} /><div className="field-foot">{(error || hint) && <p id={noteId} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}{counter !== undefined && counter !== false && <span className="field-counter">{counter === true ? `${count}${props.maxLength ? ` / ${props.maxLength}` : ''} символов` : counter}</span>}</div></div>;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldExtras>(function Select({ label, error, hint, id, className, 'aria-describedby': describedBy, children, ...props }, ref) {
  const generatedId = useId(); const fieldId = id ?? generatedId; const noteId = `${fieldId}-note`;
  return <div className="form-field">{label && <label className="field-label" htmlFor={fieldId}>{label}{props.required && <span className="required-mark"> *</span>}</label>}<select {...props} ref={ref} id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={cx(describedBy, (error || hint) && noteId) || undefined} className={cx('input', 'select', error && 'input-error', className)}>{children}</select>{(error || hint) && <p id={noteId} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}</div>;
});

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="empty-state"><div className="empty-state-icon"><Icon size={28} strokeWidth={1.6} aria-hidden="true" /></div><h2>{title}</h2>{description && <p>{description}</p>}{action && <div className="empty-state-action">{action}</div>}</div>;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-banner" role="alert"><AlertCircle size={21} aria-hidden="true" /><div><strong>Не удалось выполнить действие</strong><p>{message}</p></div>{onRetry && <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Повторить</Button>}</div>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) { return <div className="skeleton-block" role="status" aria-label="Загрузка"><span className="sr-only">Загрузка…</span>{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton-line" style={{ width: i === lines - 1 ? '62%' : i === 0 ? '82%' : '100%' }} />)}</div>; }
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) { return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>; }
export function Tags({ items }: { items: string[] }) { return <div className="tags">{items.map((item, i) => <span key={`${item}-${i}`} className="tag">{item}</span>)}</div>; }
export function TextLink({ children, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={cx('text-link', props.className)}>{children}<ArrowRight size={15} aria-hidden="true" /></span>; }
