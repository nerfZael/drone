import React from 'react';
import { createPortal } from 'react-dom';
import { GUIDED_ONBOARDING_STEPS } from './steps';
import {
  dismissOnboardingStep,
  isOnboardingStepDismissed,
  readOnboardingDismissals,
  type OnboardingDismissals,
  writeOnboardingDismissals,
} from './storage';

export type GuidedOnboardingStep = {
  id: string;
  version: number;
  selector: string;
  title: string;
  body: React.ReactNode;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getTargetEl(selector: string): HTMLElement | null {
  try {
    const el = document.querySelector(selector);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
    ),
  );
  return nodes.filter((n) => {
    if (n.hasAttribute('disabled')) return false;
    const style = window.getComputedStyle(n);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
}

function computeTooltipPosition(opts: {
  targetRect: DOMRect | null;
  tooltipRect: DOMRect | null;
}): { left: number; top: number; maxWidth: number; mode: 'anchored' | 'centered' } {
  const margin = 12;
  const maxWidth = Math.min(420, window.innerWidth - margin * 2);
  const t = opts.targetRect;
  const tip = opts.tooltipRect;
  if (!t || !tip) {
    return {
      left: Math.round((window.innerWidth - maxWidth) / 2),
      top: Math.round(window.innerHeight * 0.2),
      maxWidth,
      mode: 'centered',
    };
  }

  const belowTop = t.bottom + 12;
  const aboveTop = t.top - tip.height - 12;
  const canFitBelow = belowTop + tip.height + margin <= window.innerHeight;
  const canFitAbove = aboveTop >= margin;

  const top = canFitBelow ? belowTop : canFitAbove ? aboveTop : clamp(belowTop, margin, window.innerHeight - tip.height - margin);
  const idealLeft = t.left + t.width / 2 - tip.width / 2;
  const left = clamp(idealLeft, margin, window.innerWidth - tip.width - margin);

  return { left: Math.round(left), top: Math.round(top), maxWidth, mode: 'anchored' };
}

export function GuidedOnboarding({ steps = GUIDED_ONBOARDING_STEPS }: { steps?: GuidedOnboardingStep[] }) {
  const [dismissals, setDismissals] = React.useState<OnboardingDismissals>(() => readOnboardingDismissals());
  const dismissalsRef = React.useRef<OnboardingDismissals>(dismissals);
  React.useEffect(() => {
    dismissalsRef.current = dismissals;
  }, [dismissals]);

  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState<number | null>(null);
  const autoStartedRef = React.useRef(false);

  const step = stepIndex != null ? steps[stepIndex] ?? null : null;
  const stepLabelId = step ? `onboarding-title-${step.id}` : undefined;
  const stepBodyId = step ? `onboarding-body-${step.id}` : undefined;

  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltipRect, setTooltipRect] = React.useState<DOMRect | null>(null);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);

  const eligibleIndex = React.useCallback(
    (preferExistingTarget: boolean): number | null => {
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        if (isOnboardingStepDismissed(dismissalsRef.current, s.id, s.version)) continue;
        if (!preferExistingTarget) return i;
        if (getTargetEl(s.selector)) return i;
      }
      return null;
    },
    [steps],
  );

  // Auto-start once per page load for new/undismissed users.
  React.useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    let cancelled = false;
    const startMs = performance.now();

    const tick = () => {
      if (cancelled) return;
      const idx = eligibleIndex(true);
      if (idx != null) {
        setStepIndex(idx);
        setOpen(true);
        return;
      }
      if (performance.now() - startMs > 1800) {
        const fallback = eligibleIndex(false);
        if (fallback != null) {
          setStepIndex(fallback);
          setOpen(true);
        }
        return;
      }
      requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [eligibleIndex]);

  // Keep in sync across tabs.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'droneHub.onboarding.dismissals') return;
      setDismissals(readOnboardingDismissals());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persistDismissals = React.useCallback((next: OnboardingDismissals) => {
    setDismissals(next);
    writeOnboardingDismissals(next);
  }, []);

  const dismissCurrent = React.useCallback(() => {
    if (!step) {
      setOpen(false);
      setStepIndex(null);
      return;
    }
    const next = dismissOnboardingStep(dismissalsRef.current, step.id, step.version);
    persistDismissals(next);
    setOpen(false);
  }, [persistDismissals, step]);

  const skipAll = React.useCallback(() => {
    const next: OnboardingDismissals = { ...dismissalsRef.current };
    for (const s of steps) next[s.id] = Math.max(next[s.id] ?? 0, s.version);
    persistDismissals(next);
    setOpen(false);
    setStepIndex(null);
  }, [persistDismissals, steps]);

  const goBack = React.useCallback(() => {
    if (stepIndex == null) return;
    if (stepIndex <= 0) return;
    setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  const goNext = React.useCallback(() => {
    if (stepIndex == null || !step) return;
    const afterDismiss = dismissOnboardingStep(dismissalsRef.current, step.id, step.version);
    persistDismissals(afterDismiss);

    // Prefer advancing to a step whose target currently exists.
    for (let i = stepIndex + 1; i < steps.length; i += 1) {
      const s = steps[i];
      if (isOnboardingStepDismissed(afterDismiss, s.id, s.version)) continue;
      if (!getTargetEl(s.selector)) continue;
      setStepIndex(i);
      return;
    }
    // Fall back to the next undismissed step.
    for (let i = stepIndex + 1; i < steps.length; i += 1) {
      const s = steps[i];
      if (isOnboardingStepDismissed(afterDismiss, s.id, s.version)) continue;
      setStepIndex(i);
      return;
    }
    setOpen(false);
    setStepIndex(null);
  }, [persistDismissals, step, stepIndex, steps]);

  // Measure tooltip for positioning.
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = tooltipRef.current;
    if (!el) return;
    setTooltipRect(el.getBoundingClientRect());
  }, [open, stepIndex]);

  // Track target rect and keep tooltip positioned on scroll/resize/layout changes.
  React.useEffect(() => {
    if (!open || !step) return;

    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const el = getTargetEl(step.selector);
      setTargetRect(el ? el.getBoundingClientRect() : null);
    };

    const onScrollOrResize = () => update();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);

    const mo = new MutationObserver(() => update());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });

    update();
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      mo.disconnect();
    };
  }, [open, step]);

  // Scroll the target into view when a step activates.
  React.useEffect(() => {
    if (!open || !step) return;
    const el = getTargetEl(step.selector);
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch {
      // ignore
    }
  }, [open, stepIndex, step]);

  // Focus management + keyboard controls.
  React.useEffect(() => {
    if (!open) return;
    const root = tooltipRef.current;
    if (!root) return;

    const focusables = getFocusable(root);
    (focusables[0] ?? root).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissCurrent();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key !== 'Tab') return;

      const el = tooltipRef.current;
      if (!el) return;
      const items = getFocusable(el);
      if (items.length === 0) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const idx = active ? items.indexOf(active) : -1;
      const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx >= items.length - 1 ? 0 : idx + 1;
      e.preventDefault();
      items[next]?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissCurrent, goBack, goNext, open, stepIndex]);

  if (!open || stepIndex == null || !step || steps.length === 0) return null;

  const pos = computeTooltipPosition({ targetRect, tooltipRect });
  const stepNumber = stepIndex + 1;
  const isLast = stepIndex >= steps.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[1000]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* Highlight */}
      {targetRect ? (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none rounded-lg border border-[var(--accent-muted)]/80"
          style={{
            left: Math.max(0, Math.round(targetRect.left) - 6),
            top: Math.max(0, Math.round(targetRect.top) - 6),
            width: Math.round(targetRect.width) + 12,
            height: Math.round(targetRect.height) + 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      ) : null}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={stepLabelId}
        aria-describedby={stepBodyId}
        tabIndex={-1}
        className="absolute animate-slide-up outline-none"
        style={{
          left: pos.left,
          top: pos.top,
          maxWidth: pos.maxWidth,
        }}
      >
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_16px_80px_rgba(0,0,0,.55)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9px] font-semibold tracking-[0.16em] uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Guided onboarding
              </div>
              <div id={stepLabelId} className="mt-1 text-[13px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                {step.title}
              </div>
            </div>
            <button
              type="button"
              onClick={dismissCurrent}
              className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-colors"
              aria-label="Dismiss this tip"
              title="Dismiss (Esc)"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <div id={stepBodyId} className="px-4 py-3 text-[12px] text-[var(--fg-secondary)] leading-5">
            {step.body}
            {pos.mode === 'centered' ? (
              <div className="mt-2 text-[10px] text-[var(--muted-dim)]">
                This control isn’t visible right now. Try selecting a drone or opening the right panel to follow along.
              </div>
            ) : null}
          </div>

          <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center gap-2">
            <button
              type="button"
              onClick={skipAll}
              className="h-8 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-colors"
              style={{ fontFamily: 'var(--display)' }}
              title="Dismiss all tips"
            >
              Skip all
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex <= 0}
              className={`h-8 px-3 rounded-md border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                stepIndex <= 0
                  ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Back (←)"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className="h-8 px-3 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[10px] font-semibold tracking-wide uppercase text-[var(--accent)] hover:brightness-110 transition-all"
              style={{ fontFamily: 'var(--display)' }}
              title={isLast ? 'Done (→)' : 'Next (→)'}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>

          <div className="px-4 pb-3 text-[10px] text-[var(--muted-dim)] flex items-center justify-between gap-2">
            <span>
              Step {stepNumber} / {steps.length}
            </span>
            <span className="hidden sm:inline">
              Keys: Esc dismiss · ←/→ navigate · Tab cycles
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

