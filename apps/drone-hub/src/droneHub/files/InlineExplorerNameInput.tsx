import React from 'react';
import { fileNameStemSelectionEnd } from './explorer-state';

type InlineExplorerNameInputProps = {
  value: string;
  mode: 'create-file' | 'create-directory' | 'rename';
  loading: boolean;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function InlineExplorerNameInput({
  value,
  mode,
  loading,
  onChange,
  onSubmit,
  onCancel,
}: InlineExplorerNameInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const previousLoadingRef = React.useRef(loading);
  const initialSelectionEndRef = React.useRef(
    mode === 'rename' ? fileNameStemSelectionEnd(value) : value.length,
  );

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, initialSelectionEndRef.current);
  }, []);

  React.useLayoutEffect(() => {
    if (previousLoadingRef.current && !loading) inputRef.current?.focus();
    previousLoadingRef.current = loading;
  }, [loading]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      disabled={loading}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={() => {
        if (loading) return;
        if (value.trim()) onSubmit();
        else onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSubmit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="h-[19px] min-w-0 flex-1 rounded-sm border border-[var(--accent)] bg-[var(--panel-alt)] px-1 text-[var(--text-12)] leading-none text-[var(--fg)] outline-none disabled:opacity-60"
      aria-label={
        mode === 'rename'
          ? 'Rename item'
          : mode === 'create-file'
            ? 'New file name'
            : 'New folder name'
      }
    />
  );
}
