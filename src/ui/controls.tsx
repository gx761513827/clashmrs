import { useState, type ChangeEvent, type ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle !== undefined && (
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary:
    'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700',
  ghost: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'secondary',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        BUTTON_STYLES[variant]
      } ${rest.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  monospace = false,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  monospace?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className={`rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 ${
          monospace ? 'font-mono' : ''
        }`}
      />
      {hint !== undefined && <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">{label}</span>
        {hint !== undefined && (
          <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</span>
        )}
      </span>
    </label>
  );
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? '已复制' : label}
    </Button>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  const tones: Record<string, string> = {
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>
  );
}

export function Notice({
  tone,
  children,
  onDismiss,
}: {
  tone: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-100',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
  } as const;
  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${tones[tone]}`}>
      <div className="whitespace-pre-wrap break-words">{children}</div>
      {onDismiss !== undefined && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label="关闭">
          ✕
        </button>
      )}
    </div>
  );
}
