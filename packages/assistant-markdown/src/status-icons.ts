import {
  hasMarkdownStatusEmoji,
  splitMarkdownStatusEmoji,
  type MarkdownStatus,
} from '@drone/markdown-status-icons';

type HastText = { type: 'text'; value: string };
type HastElement = {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};
type HastParent = { type: string; children?: HastNode[] };
type HastNode = HastText | HastElement | HastParent;

function isText(node: HastNode): node is HastText {
  return node.type === 'text';
}

// Code keeps its literal characters; inline SVG is already drawn.
const SKIPPED_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'svg', 'math']);

function element(tagName: string, properties: Record<string, unknown>, children: HastNode[] = []): HastElement {
  return { type: 'element', tagName, properties, children };
}

function statusElement(status: MarkdownStatus, emoji: string): HastElement {
  return element(
    'span',
    {
      className: ['dh-md-status', `dh-md-status--${status.tone}`],
      role: 'img',
      ariaLabel: status.label,
      dataStatus: status.kind,
    },
    [
      element(
        'svg',
        { className: ['dh-md-status__icon'], viewBox: '0 0 24 24', ariaHidden: 'true' },
        status.icon.map(([tagName, attributes]) => element(tagName, { ...attributes })),
      ),
      // The emoji stays in the DOM, visually hidden, so copied text keeps it.
      element('span', { className: ['dh-md-status__text'] }, [{ type: 'text', value: emoji }]),
    ],
  );
}

function replaceStatusEmoji(parent: HastParent): void {
  const children = parent.children;
  if (!children) return;
  const next: HastNode[] = [];
  let changed = false;
  for (const child of children) {
    if (!isText(child)) {
      const skipped = child.type === 'element' && SKIPPED_TAGS.has((child as HastElement).tagName);
      if (!skipped) replaceStatusEmoji(child);
      next.push(child);
      continue;
    }
    if (!hasMarkdownStatusEmoji(child.value)) {
      next.push(child);
      continue;
    }
    for (const segment of splitMarkdownStatusEmoji(child.value)) {
      next.push(
        segment.type === 'status'
          ? statusElement(segment.status, segment.text)
          : { type: 'text', value: segment.text },
      );
    }
    changed = true;
  }
  if (changed) parent.children = next;
}

/** Rehype plugin: draws status emoji (✅ 🔄 ⏳ …) as theme-coloured line icons. */
export function rehypeStatusIcons() {
  return (tree: HastParent) => {
    replaceStatusEmoji(tree);
  };
}
