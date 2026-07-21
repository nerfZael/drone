export const DESKTOP_THEME_IDS = ['monolith', 'catppuccin-mocha'] as const;

export type DesktopThemeId = (typeof DESKTOP_THEME_IDS)[number];

export const DEFAULT_DESKTOP_THEME_ID: DesktopThemeId = 'catppuccin-mocha';

export type DesktopMonacoTheme = {
  id: string;
  definition: {
    base: 'vs-dark';
    inherit: true;
    rules: Array<{ token: string; foreground: string; fontStyle?: string }>;
    colors: Record<string, string>;
  };
};

export type DesktopThemeDefinition = {
  id: DesktopThemeId;
  label: string;
  description: string;
  swatches: readonly [string, string, string, string];
  browserColor: string;
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
};

const DESKTOP_THEME_BY_ID: Record<DesktopThemeId, DesktopThemeDefinition> = {
  monolith: {
    id: 'monolith',
    label: 'Monolith',
    description: 'The refined Drone Hub look: graphite surfaces with a focused violet accent.',
    swatches: ['#0c0f14', '#171d27', '#b19cff', '#65e69a'],
    browserColor: '#0c0f14',
    terminal: {
      background: '#0c0f14',
      foreground: '#c7cdda',
      cursor: '#b19cff',
      cursorAccent: '#0c0f14',
      selectionBackground: 'rgba(177,156,255,.18)',
      black: '#1c2330',
      red: '#ff7373',
      green: '#65e69a',
      yellow: '#ffc15a',
      blue: '#7aa2f7',
      magenta: '#c6a0f6',
      cyan: '#6bdde3',
      white: '#dfe3ea',
      brightBlack: '#667085',
      brightRed: '#ff9292',
      brightGreen: '#8aefad',
      brightYellow: '#ffd37d',
      brightBlue: '#9ab7fa',
      brightMagenta: '#dac0fb',
      brightCyan: '#92e9ed',
      brightWhite: '#f3f5f8',
    },
  },
  'catppuccin-mocha': {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'A warmer dark palette matching Drone Hub mobile, with Catppuccin pastels.',
    swatches: ['#1e1e2e', '#313244', '#cba6f7', '#a6e3a1'],
    browserColor: '#1e1e2e',
    terminal: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#11111b',
      selectionBackground: 'rgba(147,153,178,.25)',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#a6adc8',
      brightBlack: '#585b70',
      brightRed: '#f37799',
      brightGreen: '#89d88b',
      brightYellow: '#ebd391',
      brightBlue: '#74a8fc',
      brightMagenta: '#f2aede',
      brightCyan: '#6bd7ca',
      brightWhite: '#bac2de',
    },
  },
};

export const DESKTOP_THEMES: readonly DesktopThemeDefinition[] = DESKTOP_THEME_IDS.map(
  (themeId) => DESKTOP_THEME_BY_ID[themeId],
);

function isDesktopThemeId(value: unknown): value is DesktopThemeId {
  return typeof value === 'string' && DESKTOP_THEME_IDS.some((themeId) => themeId === value);
}

export function normalizeDesktopThemeId(value: unknown): DesktopThemeId {
  return isDesktopThemeId(value) ? value : DEFAULT_DESKTOP_THEME_ID;
}

export function desktopThemeDefinition(themeId: unknown): DesktopThemeDefinition {
  return DESKTOP_THEME_BY_ID[normalizeDesktopThemeId(themeId)];
}

const MONOLITH_MONACO_THEME: DesktopMonacoTheme = {
  id: 'drone-hub-monolith',
  definition: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '858EA3', fontStyle: 'italic' },
      { token: 'string', foreground: '65E69A' },
      { token: 'number', foreground: 'FFB77A' },
      { token: 'keyword', foreground: 'C9A9FF' },
      { token: 'type', foreground: 'FFC15A' },
      { token: 'type.identifier', foreground: 'FFC15A' },
      { token: 'function', foreground: '8DB4FF' },
      { token: 'variable', foreground: 'C7CDDA' },
      { token: 'regexp', foreground: 'C6A0F6' },
      { token: 'tag', foreground: 'FF8585' },
      { token: 'attribute.name', foreground: 'FFC15A' },
    ],
    colors: {
      'editor.background': '#0C0F14',
      'editor.foreground': '#C7CDDA',
      'editorCursor.foreground': '#B19CFF',
      'editor.selectionBackground': '#B19CFF33',
      'editor.inactiveSelectionBackground': '#3B455766',
      'editor.lineHighlightBackground': '#171D2788',
      'editorLineNumber.foreground': '#667085',
      'editorLineNumber.activeForeground': '#A2AABC',
      'editorIndentGuide.background1': '#293241',
      'editorIndentGuide.activeBackground1': '#3B4557',
      'editorWhitespace.foreground': '#293241',
      'editorWidget.background': '#11161E',
      'editorWidget.border': '#3B4557',
      'editorHoverWidget.background': '#171D27',
      'editorHoverWidget.border': '#3B4557',
      'input.background': '#0C0F14',
      'input.border': '#3B4557',
      'focusBorder': '#9678FA',
      'list.hoverBackground': '#FFFFFF0D',
      'list.activeSelectionBackground': '#B19CFF1A',
      'list.activeSelectionForeground': '#E5E9F0',
      'scrollbarSlider.background': '#66708555',
      'scrollbarSlider.hoverBackground': '#858EA377',
    },
  },
};

const CATPPUCCIN_MOCHA_MONACO_THEME: DesktopMonacoTheme = {
  id: 'drone-hub-catppuccin-mocha',
  definition: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9399B2', fontStyle: 'italic' },
      { token: 'string', foreground: 'A6E3A1' },
      { token: 'number', foreground: 'FAB387' },
      { token: 'keyword', foreground: 'CBA6F7' },
      { token: 'type', foreground: 'F9E2AF' },
      { token: 'type.identifier', foreground: 'F9E2AF' },
      { token: 'function', foreground: '89B4FA' },
      { token: 'variable', foreground: 'CDD6F4' },
      { token: 'variable.parameter', foreground: 'EBA0AC' },
      { token: 'operator', foreground: '89DCEB' },
      { token: 'delimiter', foreground: '9399B2' },
      { token: 'regexp', foreground: 'F5C2E7' },
      { token: 'tag', foreground: 'F38BA8' },
      { token: 'attribute.name', foreground: 'F9E2AF' },
      { token: 'annotation', foreground: 'F9E2AF' },
      { token: 'macro', foreground: 'F5E0DC' },
    ],
    colors: {
      'editor.background': '#1E1E2E',
      'editor.foreground': '#CDD6F4',
      'editorCursor.foreground': '#F5E0DC',
      'editor.selectionBackground': '#9399B240',
      'editor.inactiveSelectionBackground': '#9399B226',
      'editor.lineHighlightBackground': '#CDD6F41A',
      'editorLineNumber.foreground': '#7F849C',
      'editorLineNumber.activeForeground': '#B4BEFE',
      'editorIndentGuide.background1': '#45475A',
      'editorIndentGuide.activeBackground1': '#585B70',
      'editorWhitespace.foreground': '#45475A',
      'editorWidget.background': '#181825',
      'editorWidget.border': '#585B70',
      'editorHoverWidget.background': '#181825',
      'editorHoverWidget.border': '#585B70',
      'input.background': '#11111B',
      'input.border': '#585B70',
      'focusBorder': '#B4BEFE',
      'list.hoverBackground': '#CDD6F412',
      'list.activeSelectionBackground': '#CBA6F712',
      'list.activeSelectionForeground': '#CDD6F4',
      'scrollbarSlider.background': '#6C708655',
      'scrollbarSlider.hoverBackground': '#9399B277',
    },
  },
};

const DESKTOP_MONACO_THEME_BY_ID: Record<DesktopThemeId, DesktopMonacoTheme> = {
  monolith: MONOLITH_MONACO_THEME,
  'catppuccin-mocha': CATPPUCCIN_MOCHA_MONACO_THEME,
};

export function desktopMonacoTheme(themeId: unknown): DesktopMonacoTheme {
  return DESKTOP_MONACO_THEME_BY_ID[normalizeDesktopThemeId(themeId)];
}

export function applyDesktopTheme(themeId: unknown): DesktopThemeId {
  const theme = desktopThemeDefinition(themeId);
  if (typeof document === 'undefined') return theme.id;
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = 'dark';
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.browserColor);
  return theme.id;
}
