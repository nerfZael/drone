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
  reversed?: boolean;
  onValueChange: (value: number) => void;
  onResizingChange?: (resizing: boolean) => void;
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
  reversed = false,
  onValueChange,
  onResizingChange,
  onReset,
  className,
  ...props
}: UiResizeHandleProps) {
  const dragRef = React.useRef<{ pointer: number; value: number } | null>(null);
  const bodyStyleRef = React.useRef<{ cursor: string; userSelect: string } | null>(null);
  const [resizing, setResizing] = React.useState(false);
  const vertical = orientation === 'vertical';
  const direction = reversed ? -1 : 1;

  const stopResizing = () => {
    dragRef.current = null;
    setResizing(false);
    onResizingChange?.(false);
    if (!bodyStyleRef.current) return;
    document.body.style.cursor = bodyStyleRef.current.cursor;
    document.body.style.userSelect = bodyStyleRef.current.userSelect;
    bodyStyleRef.current = null;
  };

  React.useEffect(
    () => () => {
      if (!bodyStyleRef.current) return;
      document.body.style.cursor = bodyStyleRef.current.cursor;
      document.body.style.userSelect = bodyStyleRef.current.userSelect;
      bodyStyleRef.current = null;
    },
    [],
  );

  const changeByKey = (key: string) => {
    const decrease = vertical ? key === 'ArrowLeft' : key === 'ArrowUp';
    const increase = vertical ? key === 'ArrowRight' : key === 'ArrowDown';
    if (decrease) onValueChange(clamp(value - step * direction, min, max));
    else if (increase) onValueChange(clamp(value + step * direction, min, max));
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
        onResizingChange?.(true);
        bodyStyleRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const pointer = vertical ? event.clientX : event.clientY;
        onValueChange(
          clamp(
            dragRef.current.value + (pointer - dragRef.current.pointer) * direction,
            min,
            max,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        stopResizing();
      }}
      onPointerCancel={stopResizing}
      onLostPointerCapture={stopResizing}
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
