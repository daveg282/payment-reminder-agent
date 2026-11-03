import { ReactNode } from 'react';
import { ApiError, ReminderStatus, ReplyClass, RiskLabel, Tone } from '../api';
import { money, sentence } from '../format';

export const Spinner = () => <span className="spinner" aria-hidden="true" />;

export function Loading({ label = 'Loading…', rows = 0 }: { label?: string; rows?: number }) {
  if (rows > 0) {
    return (
      <div className="panel panel-pad" aria-busy="true" aria-label={label} style={{ display: 'grid', gap: 14 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: `${88 - i * 9}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="state state-loading" aria-busy="true">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div className="panel state" role="alert">
      <h3>Something went wrong</h3>
      <p>{error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state compact">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const RISK_TEXT: Record<RiskLabel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

/** Risk is always shown as text; colour only reinforces it. */
export function RiskBadge({ label, reason }: { label: RiskLabel; reason?: string }) {
  return (
    <span className={`badge badge-${label}`} title={reason ? sentence(reason) : undefined}>
      {RISK_TEXT[label]}
    </span>
  );
}

export function RiskCell({ label, reason }: { label: RiskLabel; reason: string }) {
  return (
    <div className="risk-cell">
      <RiskBadge label={label} reason={reason} />
      <span className="risk-reason">{sentence(reason)}</span>
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = { friendly: 'Friendly', firm: 'Firm', final: 'Final' };
export const ToneChip = ({ tone }: { tone: Tone }) => <span className={`badge badge-plain ${tone === 'final' ? 'badge-high' : tone === 'firm' ? 'badge-medium' : 'badge-neutral'}`}>{TONE_TEXT[tone]} tone</span>;

const STATUS_TEXT: Record<ReminderStatus, string> = { draft: 'Draft', approved: 'Sending', sent: 'Sent', skipped: 'Skipped', failed: 'Failed' };
export function ReminderStatusChip({ status }: { status: ReminderStatus }) {
  const cls = status === 'sent' ? 'badge-low' : status === 'failed' ? 'badge-high' : status === 'skipped' ? 'badge-neutral' : 'badge-accent';
  return <span className={`badge ${cls}`}>{STATUS_TEXT[status]}</span>;
}

export const CLASS_TEXT: Record<ReplyClass, string> = {
  promise_to_pay: 'Promise to pay',
  dispute: 'Dispute',
  already_paid: 'Says already paid',
  other: 'Other',
  needs_review: 'Needs review',
};
export const NEEDS_YOU: ReplyClass[] = ['dispute', 'already_paid', 'needs_review'];
export function ClassChip({ value }: { value: ReplyClass }) {
  const cls = value === 'promise_to_pay' ? 'badge-low' : NEEDS_YOU.includes(value) ? 'badge-high' : 'badge-neutral';
  return <span className={`badge ${cls}`}>{CLASS_TEXT[value]}</span>;
}

export const Money = ({ amount, currency }: { amount: number; currency?: string }) => <span className="num">{money(amount, currency)}</span>;
