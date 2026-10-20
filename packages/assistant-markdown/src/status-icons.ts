import {
  hasMarkdownStatusEmoji,
  leadingMarkdownStatus,
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

function addClass(node: HastElement, className: string): void {
  const current = node.properties.className;
  const list = Array.isArray(current) ? current : typeof current === 'string' ? current.split(/\s+/) : [];
  node.properties.className = [...list, className];
}

function statusElement(
  status: MarkdownStatus,
  emoji: string,
  { lead = false, dimmed = false }: { lead?: boolean; dimmed?: boolean } = {},
): HastElement {
  return element(
    'span',
    {
      className: [
        'dh-md-status',
        `dh-md-status--${status.tone}`,
        ...(lead ? ['dh-md-status--lead'] : []),
        ...(dimmed ? ['dh-md-status--dimmed'] : []),
      ],
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
      const skipped = child.type === 'element'
        && (SKIPPED_TAGS.has((child as HastElement).tagName) || 'dataStatus' in (child as HastElement).properties);
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

function isElement(node: HastNode | undefined, tagNames?: ReadonlySet<string>): node is HastElement {
  return node?.type === 'element' && (!tagNames || tagNames.has((node as HastElement).tagName));
}

// Formatting that may wrap the opening emoji, as in `- ~~✅ Shipped~~`.
const LEADING_WRAPPERS = new Set(['p', 'del', 's', 'strong', 'b', 'em', 'i']);

// A bullet item that opens with a status emoji draws the icon in place of the
// bullet, so wrapped lines line up under the text instead of under the icon.
function hangLeadingStatus(item: HastElement): void {
  let line = item;
  let node = item;
  let dimmed = false;
  for (;;) {
    const first = node.children.find((child) => !(isText(child) && !child.value.trim()));
    if (!first) return;
    if (isText(first)) {
      const lead = leadingMarkdownStatus(first.value.trimStart());
      if (!lead) return;
      first.value = lead.rest;
      line.children.unshift(statusElement(lead.status, lead.marker, { lead: true, dimmed }));
      addClass(item, 'dh-md-status-item');
      if (line !== item) addClass(line, 'dh-md-status-line');
      return;
    }
    if (!isElement(first, LEADING_WRAPPERS)) return;
    if (first.tagName === 'p') {
      if (node !== item) return;
      line = first;
    }
    if (first.tagName === 'del' || first.tagName === 's') dimmed = true;
    node = first;
  }
}

function hangListStatuses(parent: HastParent): void {
  for (const child of parent.children ?? []) {
    if (!isElement(child) || SKIPPED_TAGS.has(child.tagName)) continue;
    if (child.tagName === 'ul') {
      for (const item of child.children) {
        if (isElement(item) && item.tagName === 'li') hangLeadingStatus(item);
      }
    }
    hangListStatuses(child);
  }
}

/** Rehype plugin: draws status emoji (✅ 🔄 ⏳ …) as theme-coloured line icons. */
export function rehypeStatusIcons() {
  return (tree: HastParent) => {
    hangListStatuses(tree);
    replaceStatusEmoji(tree);
  };
}
