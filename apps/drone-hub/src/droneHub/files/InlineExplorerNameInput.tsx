import React from 'react';
import { fileNameStemSelectionEnd } from './explorer-state';

type InlineExplorerNameInputProps = {
  value: string;
  mode: 'create-file' | 'create-directory' | 'rename';
  loading: boolean;
  zoom?: number;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function InlineExplorerNameInput({
  value,
  mode,
  loading,
  zoom = 1,
  onChange,
  onSubmit,
  onCancel,
}: InlineExplorerNameInputProps) {
  const safeZoom = Math.max(0.85, Math.min(1.2, Number.isFinite(zoom) ? zoom : 1));
  const inputHeightPx = Math.max(17, Math.round(19 * safeZoom));
  const inputFontSizePx = Math.max(10.5, Math.round(12 * safeZoom * 10) / 10);
  const inputLineHeightPx = Math.max(15, inputHeightPx - 2);
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
      className="min-w-0 flex-1 rounded-sm border border-[var(--accent)] bg-[var(--panel-alt)] px-1 text-[var(--fg)] outline-none disabled:opacity-60"
      style={{
        height: `${inputHeightPx}px`,
        fontSize: `${inputFontSizePx}px`,
        lineHeight: `${inputLineHeightPx}px`,
      }}
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
