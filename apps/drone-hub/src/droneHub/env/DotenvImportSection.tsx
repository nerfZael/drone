import React from 'react';

type DotenvImportSectionProps = {
  title: string;
  description: string;
  importText: string;
  disabled: boolean;
  placeholder: string;
  onImportTextChange: (value: string) => void;
  onImportText: () => void;
  onImportFile: (file: File | null) => void | Promise<void>;
  containerClassName?: string;
  textareaClassName?: string;
};

export function DotenvImportSection({
  title,
  description,
  importText,
  disabled,
  placeholder,
  onImportTextChange,
  onImportText,
  onImportFile,
  containerClassName = 'flex flex-col gap-3',
  textareaClassName = 'min-h-[110px] rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 font-mono text-[var(--text-11)] text-[var(--fg)] focus:outline-none',
}: DotenvImportSectionProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <div className={containerClassName}>
      <div>
        <div className="text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
          {title}
        </div>
        <div className="text-[var(--text-11)] text-[var(--muted-dim)]">{description}</div>
      </div>
      <textarea
        value={importText}
        onChange={(event) => onImportTextChange(event.target.value)}
        disabled={disabled}
        className={textareaClassName}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onImportText}
          disabled={disabled || !importText.trim()}
          className={`h-8 rounded border px-3 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase ${
            disabled || !importText.trim()
              ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Import text
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={`h-8 rounded border px-3 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase ${
            disabled
              ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Import file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".env,text/plain"
          className="hidden"
          onChange={(event) => {
            void onImportFile(event.target.files?.[0] ?? null);
            event.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}
