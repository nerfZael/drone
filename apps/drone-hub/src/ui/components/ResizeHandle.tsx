import * as React from 'react';
import { cn } from '../cn';

export type UiResizeHandleProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange'
> & {
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onValueChange: (value: number) => void;
  onReset?: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function UiResizeHandle({
  orientation,
  value,
  min,
  max,
  step = 10,
  label,
  onValueChange,
  onReset,
  className,
  ...props
}: UiResizeHandleProps) {
  const dragRef = React.useRef<{ pointer: number; value: number } | null>(null);
  const [resizing, setResizing] = React.useState(false);
  const vertical = orientation === 'vertical';

  const changeByKey = (key: string) => {
    const decrease = vertical ? key === 'ArrowLeft' : key === 'ArrowUp';
    const increase = vertical ? key === 'ArrowRight' : key === 'ArrowDown';
    if (decrease) onValueChange(clamp(value - step, min, max));
    else if (increase) onValueChange(clamp(value + step, min, max));
    else if (key === 'Home') onValueChange(min);
    else if (key === 'End') onValueChange(max);
    else return false;
    return true;
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        dragRef.current = {
          pointer: vertical ? event.clientX : event.clientY,
          value,
        };
        setResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const pointer = vertical ? event.clientX : event.clientY;
        onValueChange(clamp(dragRef.current.value + pointer - dragRef.current.pointer, min, max));
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        setResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setResizing(false);
      }}
      onLostPointerCapture={() => {
        dragRef.current = null;
        setResizing(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (!changeByKey(event.key)) return;
        event.preventDefault();
      }}
      className={cn(
        'group/resize relative shrink-0 touch-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]',
        vertical ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        className,
      )}
      title={`${label}. Use arrow keys to resize${onReset ? '; double-click to reset' : ''}.`}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none absolute transition-colors group-focus-visible/resize:bg-[var(--accent)]',
          vertical
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
          resizing
            ? 'bg-[var(--accent)]'
            : 'bg-[var(--border-subtle)] group-hover/resize:bg-[var(--accent-muted)]',
        )}
        aria-hidden="true"
      />
    </div>
  );
}
