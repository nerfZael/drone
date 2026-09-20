import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';

export function UiKbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5rem] items-center justify-center rounded-[4px] border border-[var(--border)] bg-[linear-gradient(180deg,var(--surface-strong),var(--surface-inset))] px-1.5 py-0.5 font-mono text-11 font-medium leading-none text-[var(--fg-secondary)] shadow-[var(--edge-highlight),0_1.5px_0_var(--border),0_2px_3px_-1px_var(--shadow-color)]',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export type UiTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement<any>;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
};

export function UiTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
}: UiTooltipProps) {
  const tooltipId = React.useId();
  const describedBy = [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' ');
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);

  const show = React.useCallback(() => {
    if (anchorRef.current) setAnchorRect(anchorRef.current.getBoundingClientRect());
  }, []);
  const hide = React.useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setAnchorRect(null);
  }, []);

  React.useEffect(() => {
    if (!anchorRect) return;
    // The anchor moves under a fixed tooltip, so a scroll or resize dismisses it.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchorRect, hide]);
  React.useEffect(() => hide, [hide]);

  // While showing, the tooltip leaves the anchor's subtree for a fixed spot on the page.
  // A toolbar that scrolls or clips its overflow would otherwise cut it off unseen.
  const shown = anchorRect !== null && typeof document !== 'undefined';
  const gapPx = 7;
  const fixedStyle: React.CSSProperties | undefined = anchorRect
    ? {
        position: 'fixed',
        ...(side === 'top'
          ? { bottom: window.innerHeight - anchorRect.top + gapPx, top: 'auto' }
          : { top: anchorRect.bottom + gapPx, bottom: 'auto' }),
        ...(align === 'start'
          ? { left: anchorRect.left, right: 'auto' }
          : align === 'end'
            ? { right: window.innerWidth - anchorRect.right, left: 'auto' }
            : { left: anchorRect.left + anchorRect.width / 2, right: 'auto' }),
      }
    : undefined;
  const tooltip = (
    <span
      id={tooltipId}
      role="tooltip"
      style={shown ? fixedStyle : undefined}
      className={cn(
        shown && '!translate-y-0 !opacity-100',
        'pointer-events-none absolute z-[150] w-max max-w-[16rem] rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-overlay)] px-2 py-1 text-center dh-type-control-compact leading-relaxed text-[var(--fg-secondary)] opacity-0 shadow-[var(--edge-highlight),var(--shadow-menu)] backdrop-blur-md transition-[opacity,transform] duration-150',
        align === 'start'
          ? 'left-0'
          : align === 'end'
            ? 'right-0'
            : 'left-1/2 -translate-x-1/2',
        side === 'top'
          ? 'bottom-[calc(100%+0.45rem)] translate-y-0.5'
          : 'top-[calc(100%+0.45rem)] -translate-y-0.5',
      )}
    >
      {content}
      <span
        aria-hidden="true"
        className={cn(
          'absolute h-1.5 w-1.5 rotate-45 bg-[var(--panel-overlay)]',
          align === 'start'
            ? 'left-2.5'
            : align === 'end'
              ? 'right-2.5'
              : 'left-1/2 -translate-x-1/2',
          side === 'top'
            ? '-bottom-[3.5px] border-b border-r border-[var(--border)]'
            : '-top-[3.5px] border-l border-t border-[var(--border)]',
        )}
      />
    </span>
  );
  return (
    <span
      ref={anchorRef}
      className={cn('relative inline-flex', className)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(show, 300);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        // Keyboard focus only: a click also focuses, and would pin the tooltip open.
        if ((event.target as Element).matches(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {React.cloneElement(children, { 'aria-describedby': describedBy })}
      {shown ? createPortal(tooltip, document.body) : tooltip}
    </span>
  );
}
