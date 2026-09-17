/** Follow app and lazily loaded editor styles in another document or shadow root. */
export function syncDocumentStyles(source: Document, target: HTMLElement | ShadowRoot): () => void {
  const copies: Node[] = [];
  const copyStyles = () => {
    copies.splice(0).forEach(node => node.parentNode?.removeChild(node));
    source.head.querySelectorAll('style:not([data-drone-hub-desktop-title-bar]), link[rel="stylesheet"]').forEach(node => {
      const copy = node.cloneNode(true);
      target.append(copy);
      copies.push(copy);
    });
  };
  copyStyles();
  const observer = new MutationObserver(copyStyles);
  observer.observe(source.head, { childList: true, subtree: true, characterData: true, attributes: true });
  return () => { observer.disconnect(); copies.forEach(node => node.parentNode?.removeChild(node)); };
}
