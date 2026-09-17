/**
 * Fit the native panel to content; temporarily allow room for portalled menus.
 * Reports the bar's geometry with each size so the desktop can keep it fixed in place.
 */
export function observeCompanionWindowSize(host: HTMLElement, view: Window, resize: (size: CompanionWindowSize) => void): () => void {
  let frame = 0;
  let previous = '';
  let observedPanel: Element | null = null;
  const update = () => {
    frame = 0;
    const panel = host.querySelector<HTMLElement>('[data-companion-window-panel]') ?? host;
    if (panel !== observedPanel) {
      if (observedPanel) observer.unobserve(observedPanel);
      observer.observe(panel);
      observedPanel = panel;
    }
    const contentHeight = Math.ceil(Math.max(panel.scrollHeight, panel.getBoundingClientRect().height));
    // Radix constrains popovers to the viewport. Make room before measuring them
    // instead of letting a collapsed, single-row viewport permanently clip them.
    const openPopup = host.querySelector('[data-state="open"][aria-haspopup], [data-state="delayed-open"], [role="dialog"]');
    const height = Math.max(48, contentHeight, openPopup ? 600 : 0);
    const flow: CompanionWindowFlow = panel.getAttribute('data-companion-flow') === 'down' ? 'down' : 'up';
    const barRect = host.querySelector('[data-companion-window-bar]')?.getBoundingClientRect();
    const bar = barRect && barRect.height > 0
      ? { height: Math.round(barRect.height), inset: Math.max(0, Math.round(flow === 'up' ? view.innerHeight - barRect.bottom : barRect.top)) }
      : { height: Math.min(height, 48), inset: 0 };
    const size = { height, flow, bar };
    const key = JSON.stringify(size);
    if (key !== previous) { previous = key; resize(size); }
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  const mutations = new MutationObserver(schedule);
  mutations.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  view.addEventListener('resize', schedule);
  update();
  return () => {
    observer.disconnect();
    mutations.disconnect();
    view.removeEventListener('resize', schedule);
    if (frame) view.cancelAnimationFrame(frame);
  };
}
