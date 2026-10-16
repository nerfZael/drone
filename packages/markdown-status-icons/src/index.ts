// Status emoji that agents write as list markers (✅ done, 🔄 in progress, …).
// The system emoji font draws them as small pastel pictures that ignore the
// theme, so the desktop and mobile markdown renderers swap them for line icons
// in the theme's status colours. The emoji stays in the text for copying.

export type MarkdownStatusKind =
  | 'done'
  | 'failed'
  | 'blocked'
  | 'warning'
  | 'in-progress'
  | 'waiting'
  | 'todo'
  | 'skipped'
  | 'paused'
  | 'info';

export type MarkdownStatusTone = 'success' | 'danger' | 'warning' | 'info' | 'muted';

/** Lucide icon geometry (ISC licence), drawn on a 24×24 stroke grid. */
export type MarkdownStatusIconNode = ReadonlyArray<readonly [
  tag: 'circle' | 'path' | 'line',
  attributes: Readonly<Record<string, string>>,
]>;

export type MarkdownStatus = {
  kind: MarkdownStatusKind;
  label: string;
  tone: MarkdownStatusTone;
  /** Base code points; an optional U+FE0F after each is part of the match. */
  emoji: readonly string[];
  /** Lucide icon name, so native code can pick the matching component. */
  iconName: string;
  icon: MarkdownStatusIconNode;
};

const CIRCLE = ['circle', { cx: '12', cy: '12', r: '10' }] as const;

export const MARKDOWN_STATUSES: readonly MarkdownStatus[] = [
  {
    kind: 'done',
    label: 'Done',
    tone: 'success',
    emoji: ['✅', '✔', '☑'],
    iconName: 'circle-check',
    icon: [CIRCLE, ['path', { d: 'm9 12 2 2 4-4' }]],
  },
  {
    kind: 'failed',
    label: 'Failed',
    tone: 'danger',
    emoji: ['❌'],
    iconName: 'circle-x',
    icon: [CIRCLE, ['path', { d: 'm15 9-6 6' }], ['path', { d: 'm9 9 6 6' }]],
  },
  {
    kind: 'blocked',
    label: 'Blocked',
    tone: 'danger',
    emoji: ['⛔', '\u{1F6AB}'],
    iconName: 'ban',
    icon: [CIRCLE, ['path', { d: 'M4.929 4.929 19.07 19.071' }]],
  },
  {
    kind: 'warning',
    label: 'Warning',
    tone: 'warning',
    emoji: ['⚠'],
    iconName: 'triangle-alert',
    icon: [
      ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
      ['path', { d: 'M12 9v4' }],
      ['path', { d: 'M12 17h.01' }],
    ],
  },
  {
    kind: 'in-progress',
    label: 'In progress',
    tone: 'info',
    emoji: ['\u{1F504}'],
    iconName: 'refresh-cw',
    icon: [
      ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
      ['path', { d: 'M21 3v5h-5' }],
      ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
      ['path', { d: 'M8 16H3v5' }],
    ],
  },
  {
    kind: 'waiting',
    label: 'Waiting',
    tone: 'warning',
    emoji: ['⏳', '⌛'],
    iconName: 'hourglass',
    icon: [
      ['path', { d: 'M5 22h14' }],
      ['path', { d: 'M5 2h14' }],
      ['path', { d: 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22' }],
      ['path', { d: 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2' }],
    ],
  },
  {
    kind: 'todo',
    label: 'To do',
    tone: 'muted',
    emoji: ['\u{1F4CB}', '⬜'],
    iconName: 'circle-dashed',
    icon: [
      ['path', { d: 'M10.1 2.182a10 10 0 0 1 3.8 0' }],
      ['path', { d: 'M13.9 21.818a10 10 0 0 1-3.8 0' }],
      ['path', { d: 'M17.609 3.721a10 10 0 0 1 2.69 2.7' }],
      ['path', { d: 'M2.182 13.9a10 10 0 0 1 0-3.8' }],
      ['path', { d: 'M20.279 17.609a10 10 0 0 1-2.7 2.69' }],
      ['path', { d: 'M21.818 10.1a10 10 0 0 1 0 3.8' }],
      ['path', { d: 'M3.721 6.391a10 10 0 0 1 2.7-2.69' }],
      ['path', { d: 'M6.391 20.279a10 10 0 0 1-2.69-2.7' }],
    ],
  },
  {
    kind: 'skipped',
    label: 'Skipped',
    tone: 'muted',
    emoji: ['⏭'],
    iconName: 'skip-forward',
    icon: [
      ['path', { d: 'M21 4v16' }],
      ['path', { d: 'M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z' }],
    ],
  },
  {
    kind: 'paused',
    label: 'Paused',
    tone: 'muted',
    emoji: ['⏸'],
    iconName: 'circle-pause',
    icon: [
      CIRCLE,
      ['line', { x1: '10', x2: '10', y1: '15', y2: '9' }],
      ['line', { x1: '14', x2: '14', y1: '15', y2: '9' }],
    ],
  },
  {
    kind: 'info',
    label: 'Info',
    tone: 'info',
    emoji: ['ℹ'],
    iconName: 'info',
    icon: [CIRCLE, ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
  },
];

const STATUS_BY_EMOJI = new Map<string, MarkdownStatus>(
  MARKDOWN_STATUSES.flatMap((status) => status.emoji.map((emoji) => [emoji, status] as const)),
);

// Every base is a single code point. A trailing ZWJ or skin-tone modifier means the emoji is part of a larger
// sequence, which is left to the emoji font.
const STATUS_EMOJI_SOURCE =
  `(${[...STATUS_BY_EMOJI.keys()].join('|')})\\uFE0F?(?![\\u200D\\u{1F3FB}-\\u{1F3FF}])`;
const STATUS_EMOJI_PATTERN = new RegExp(STATUS_EMOJI_SOURCE, 'gu');
const STATUS_EMOJI_TEST = new RegExp(STATUS_EMOJI_SOURCE, 'u');

export type MarkdownStatusSegment =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string; status: MarkdownStatus };

export function hasMarkdownStatusEmoji(text: string): boolean {
  return STATUS_EMOJI_TEST.test(text);
}

/** Splits text around status emoji. Returns one text segment when there are none. */
export function splitMarkdownStatusEmoji(text: string): MarkdownStatusSegment[] {
  const segments: MarkdownStatusSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(STATUS_EMOJI_PATTERN)) {
    const index = match.index ?? 0;
    const status = STATUS_BY_EMOJI.get(match[1] ?? '')!;
    if (index > cursor) segments.push({ type: 'text', text: text.slice(cursor, index) });
    segments.push({ type: 'status', text: match[0], status });
    cursor = index + match[0].length;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ type: 'text', text: text.slice(cursor) });
  }
  return segments;
}

export type LeadingMarkdownStatus = {
  status: MarkdownStatus;
  /** The emoji and the whitespace after it, as written. */
  marker: string;
  rest: string;
};

const LEADING_STATUS_PATTERN = new RegExp(`^${STATUS_EMOJI_SOURCE}(?:\\s+|$)`, 'u');

/** A status emoji that opens the text, so a list can draw it in place of its bullet. */
export function leadingMarkdownStatus(text: string): LeadingMarkdownStatus | null {
  const match = LEADING_STATUS_PATTERN.exec(text);
  if (!match) return null;
  return {
    status: STATUS_BY_EMOJI.get(match[1] ?? '')!,
    marker: match[0],
    rest: text.slice(match[0].length),
  };
}
