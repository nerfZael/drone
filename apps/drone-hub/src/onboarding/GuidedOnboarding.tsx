import React from 'react';
import { createPortal } from 'react-dom';
import { GUIDED_ONBOARDING_REPLAY_EVENT } from './control';
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

function rectCenter(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function anchorOnRectEdge(opts: {
  rect: DOMRect;
  toward: { x: number; y: number };
  inset?: number;
}): { x: number; y: number } {
  const inset = opts.inset ?? 8;
  const c = rectCenter(opts.rect);
  const dx = opts.toward.x - c.x;
  const dy = opts.toward.y - c.y;
  const r = opts.rect;

  if (Math.abs(dx) > Math.abs(dy)) {
    const x = dx >= 0 ? r.right : r.left;
    const y = clamp(opts.toward.y, r.top + inset, r.bottom - inset);
    return { x, y };
  }
  const y = dy >= 0 ? r.bottom : r.top;
  const x = clamp(opts.toward.x, r.left + inset, r.right - inset);
  return { x, y };
}

function connectorPath(opts: { from: { x: number; y: number }; to: { x: number; y: number } }): string {
  const x1 = opts.from.x;
  const y1 = opts.from.y;
  const x2 = opts.to.x;
  const y2 = opts.to.y;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len = Math.hypot(vx, vy) || 1;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const px = -vy / len;
  const py = vx / len;
  const bend = Math.min(56, Math.max(18, len * 0.18));
  const cx = midX + px * bend;
  const cy = midY + py * bend;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function computeCalloutPosition(opts: {
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

  const gap = 12;
  const candidates: Array<{ left: number; top: number }> = [
    // bottom
    { left: t.left + t.width / 2 - tip.width / 2, top: t.bottom + gap },
    // top
    { left: t.left + t.width / 2 - tip.width / 2, top: t.top - tip.height - gap },
    // right
    { left: t.right + gap, top: t.top + t.height / 2 - tip.height / 2 },
    // left
    { left: t.left - tip.width - gap, top: t.top + t.height / 2 - tip.height / 2 },
  ];

  const scoreCandidate = (raw: { left: number; top: number }) => {
    const left = clamp(raw.left, margin, window.innerWidth - tip.width - margin);
    const top = clamp(raw.top, margin, window.innerHeight - tip.height - margin);
    const penalty = Math.abs(left - raw.left) + Math.abs(top - raw.top);
    const placed = { left, top, right: left + tip.width, bottom: top + tip.height };
    const overlapX = Math.max(0, Math.min(placed.right, t.right) - Math.max(placed.left, t.left));
    const overlapY = Math.max(0, Math.min(placed.bottom, t.bottom) - Math.max(placed.top, t.top));
    const overlapArea = overlapX * overlapY;
    return { left, top, penalty, overlapArea };
  };

  let best = scoreCandidate(candidates[0]!);
  for (let i = 1; i < candidates.length; i += 1) {
    const cur = scoreCandidate(candidates[i]!);
    // Prefer lower overlap, then lower penalty.
    if (cur.overlapArea < best.overlapArea || (cur.overlapArea === best.overlapArea && cur.penalty < best.penalty)) {
      best = cur;
    }
  }

  return { left: Math.round(best.left), top: Math.round(best.top), maxWidth, mode: 'anchored' };
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

  // Explicit replay trigger from Settings (clear + open step 0 deterministically).
  React.useEffect(() => {
    const onReplay = () => {
      if (!steps || steps.length === 0) return;
      // The request cleared storage; refresh local state so eligibility is correct.
      const next = readOnboardingDismissals();
      dismissalsRef.current = next;
      setDismissals(next);
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener(GUIDED_ONBOARDING_REPLAY_EVENT, onReplay as EventListener);
    return () => window.removeEventListener(GUIDED_ONBOARDING_REPLAY_EVENT, onReplay as EventListener);
  }, [steps]);

  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltipRect, setTooltipRect] = React.useState<DOMRect | null>(null);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const activeTargetRef = React.useRef<HTMLElement | null>(null);

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
    const measure = () => setTooltipRect(el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, stepIndex]);

  // Track target rect and keep tooltip positioned on scroll/resize/layout changes.
  React.useEffect(() => {
    if (!open || !step) return;

    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const el = getTargetEl(step.selector);
      if (activeTargetRef.current && activeTargetRef.current !== el) {
        activeTargetRef.current.removeAttribute('data-onboarding-active');
        activeTargetRef.current.removeAttribute('data-onboarding-active-step');
        activeTargetRef.current = null;
      }
      if (el && activeTargetRef.current !== el) {
        el.setAttribute('data-onboarding-active', 'true');
        el.setAttribute('data-onboarding-active-step', step.id);
        activeTargetRef.current = el;
      }
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
      if (activeTargetRef.current) {
        activeTargetRef.current.removeAttribute('data-onboarding-active');
        activeTargetRef.current.removeAttribute('data-onboarding-active-step');
        activeTargetRef.current = null;
      }
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

  // Non-modal keyboard shortcut: Esc dismiss (avoid stealing keys while typing).
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key !== 'Escape') return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const tag = t?.tagName?.toLowerCase();
      const isTyping =
        tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(t?.isContentEditable);
      if (isTyping) return;
      dismissCurrent();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissCurrent, open]);

  if (!open || stepIndex == null || !step || steps.length === 0) return null;

  const pos = computeCalloutPosition({ targetRect, tooltipRect });
  const stepNumber = stepIndex + 1;
  const isLast = stepIndex >= steps.length - 1;

  const connector =
    targetRect && tooltipRect && pos.mode === 'anchored'
      ? (() => {
          const tCenter = rectCenter(targetRect);
          const tipCenter = rectCenter(tooltipRect);
          const from = anchorOnRectEdge({ rect: tooltipRect, toward: tCenter, inset: 10 });
          const to = anchorOnRectEdge({ rect: targetRect, toward: tipCenter, inset: 8 });
          return { from, to, d: connectorPath({ from, to }) };
        })()
      : null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] pointer-events-none">
      {/* Connector line */}
      {connector ? (
        <svg className="absolute inset-0" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
          <path
            d={connector.d}
            fill="none"
            stroke="rgba(167, 139, 250, .70)"
            strokeWidth="1.6"
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 10px rgba(167, 139, 250, .22))' }}
          />
          <circle
            cx={connector.to.x}
            cy={connector.to.y}
            r={3.2}
            fill="rgba(167, 139, 250, .90)"
            style={{ filter: 'drop-shadow(0 0 10px rgba(167, 139, 250, .28))' }}
          />
        </svg>
      ) : null}

      {/* Target glow (non-blocking) */}
      {targetRect ? (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none rounded-lg"
          style={{
            left: Math.max(0, Math.round(targetRect.left) - 6),
            top: Math.max(0, Math.round(targetRect.top) - 6),
            width: Math.round(targetRect.width) + 12,
            height: Math.round(targetRect.height) + 12,
            border: '1px solid rgba(167, 139, 250, .55)',
            boxShadow: '0 0 0 1px rgba(167, 139, 250, .15), 0 0 26px rgba(167, 139, 250, .14)',
            background: 'rgba(167, 139, 250, .03)',
          }}
        />
      ) : null}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="region"
        aria-labelledby={stepLabelId}
        aria-describedby={stepBodyId}
        className="absolute animate-slide-up pointer-events-auto"
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
            <span className="hidden sm:inline">Tip: you can keep using the UI while this is open.</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

