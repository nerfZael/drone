import React from 'react';

export const DIFF_ZOOM_MIN = 0.9;
export const DIFF_ZOOM_DEFAULT = 1.1;
export const DIFF_ZOOM_MAX = 1.5;
export const DIFF_ZOOM_STEP = 0.1;

export function clampDiffZoom(value: number): number {
  const finiteValue = Number.isFinite(value) ? value : DIFF_ZOOM_DEFAULT;
  return Math.round(Math.min(DIFF_ZOOM_MAX, Math.max(DIFF_ZOOM_MIN, finiteValue)) * 10) / 10;
}

export function diffZoomStyle(value: number): React.CSSProperties {
  const fontSize = Math.round(10 * clampDiffZoom(value) * 10) / 10;
  return { '--changes-diff-font-size': `${fontSize}px` } as React.CSSProperties;
}

export function DiffZoomControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const zoom = clampDiffZoom(value);
  const percent = Math.round(zoom * 100);

  return (
    <div className="dh-changes-segment" aria-label="Code zoom">
      <button
        type="button"
        onClick={() => onChange(clampDiffZoom(zoom - DIFF_ZOOM_STEP))}
        disabled={zoom <= DIFF_ZOOM_MIN}
        className="dh-changes-segment-button w-7 px-0 text-[var(--text-11)]"
        title="Decrease code zoom"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onChange(DIFF_ZOOM_DEFAULT)}
        className="dh-changes-segment-button min-w-12 px-1.5 font-mono"
        title="Reset code zoom"
      >
        {percent}%
      </button>
      <button
        type="button"
        onClick={() => onChange(clampDiffZoom(zoom + DIFF_ZOOM_STEP))}
        disabled={zoom >= DIFF_ZOOM_MAX}
        className="dh-changes-segment-button w-7 px-0 text-[var(--text-11)]"
        title="Increase code zoom"
      >
        +
      </button>
    </div>
  );
}
