import { describe, expect, test } from 'bun:test';
import { colors } from '../src/theme';

type Rgb = [number, number, number];

function parseColor(color: string): { rgb: Rgb; alpha: number } {
  if (color.startsWith('#')) {
    const channels = color
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16));
    return { rgb: channels as Rgb, alpha: 1 };
  }

  const match = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!match) throw new Error(`Unsupported theme color: ${color}`);
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  };
}

function composite(foreground: string, background: string): Rgb {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  return foregroundColor.rgb.map((channel, index) =>
    Math.round(
      channel * foregroundColor.alpha + backgroundColor.rgb[index] * (1 - foregroundColor.alpha),
    ),
  ) as Rgb;
}

function relativeLuminance(color: string | Rgb) {
  const rgb = typeof color === 'string' ? parseColor(color).rgb : color;
  const channels = rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string | Rgb, background: string | Rgb) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('mobile theme contrast', () => {
  test('keeps the readable hierarchy and the established user-message treatment explicit', () => {
    expect(colors.text).toBe('#e6e9ff');
    expect(colors.textSecondary).toBe('#cdd6f4');
    expect(colors.textStrong).toBe('#f2f4ff');
    expect(colors.muted).toBe('#bac2de');
    expect(colors.secondary).toBe('#a6adc8');
    expect(colors.mutedDim).toBe('#9399b2');
    expect(colors.border).toBe('rgba(69, 71, 90, 0.56)');
    expect(colors.borderSubtle).toBe('rgba(49, 50, 68, 0.78)');
    expect(colors.accentDark).toBe('rgba(203, 166, 247, 0.075)');
    expect(colors.accentBorder).toBe('rgba(203, 166, 247, 0.26)');
    expect(colors.accentWash).toBe('rgba(203, 166, 247, 0.06)');
    expect(colors.sidebarSelectionWash).toBe('rgba(203, 166, 247, 0.12)');
    expect(colors.sidebarSelectionEdge).toBe('rgba(203, 166, 247, 0.78)');
    expect(colors.sidebarBlockedIndicator).toBe('#ff596b');
    expect(colors.link).toBe('#89b4fa');
    expect(colors.cursor).toBe('#f5e0dc');
    expect(colors.selectionWash).toBe('rgba(147, 153, 178, 0.24)');
    expect(colors.textSelection).toBe('rgba(147, 153, 178, 0.25)');
    expect(colors.composerBorder).toBe('rgba(69, 71, 90, 0.56)');
    expect(colors.controlSurface).toBe('rgba(69, 71, 90, 0.34)');
    expect(colors.assistantText).toBe('#cdd6f4');
    expect(colors.chatCard).toBe('#242437');
    expect(colors.chatCardSelected).toBe('#313244');

    expect(colors.userBubble).toBe('#45475a');
    expect(colors.userBubbleBorder).toBe('#585b70');
    expect(colors.userBubbleText).toBe('#f5e0dc');
    expect(contrastRatio(colors.userBubbleText, colors.userBubble)).toBeGreaterThanOrEqual(4.5);
  });

  test('keeps secondary text readable on its standard surfaces', () => {
    for (const foreground of [colors.muted, colors.subtle]) {
      for (const background of [colors.background, colors.panel, colors.panelRaised]) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(contrastRatio(colors.muted, colors.surface1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.subtle, colors.crust)).toBeGreaterThanOrEqual(4.5);
    for (const background of [colors.background, colors.panel]) {
      expect(contrastRatio(colors.mutedDim, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps links readable on standard content surfaces', () => {
    for (const background of [colors.background, colors.panel, colors.panelRaised]) {
      expect(contrastRatio(colors.link, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps primary text readable on raised message surfaces', () => {
    for (const foreground of [colors.text, colors.textStrong]) {
      for (const background of [colors.surface1, colors.surface2]) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('keeps strong control boundaries distinguishable', () => {
    for (const background of [colors.background, colors.panel, colors.panelRaised]) {
      expect(contrastRatio(colors.borderStrong, background)).toBeGreaterThanOrEqual(3);
    }
  });

  test('keeps solid status foreground content readable', () => {
    for (const background of [colors.accent, colors.online, colors.warning, colors.danger]) {
      expect(contrastRatio(colors.onAccent, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps status text readable on translucent state surfaces', () => {
    const states = [
      [colors.accent, colors.accentDark],
      [colors.online, colors.onlineDark],
      [colors.warning, colors.warningDark],
      [colors.danger, colors.dangerDark],
    ] as const;

    for (const [foreground, surface] of states) {
      for (const parent of [colors.background, colors.panel, colors.panelRaised]) {
        expect(contrastRatio(foreground, composite(surface, parent))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
