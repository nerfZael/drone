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
      channel * foregroundColor.alpha +
        backgroundColor.rgb[index] * (1 - foregroundColor.alpha),
    ),
  ) as Rgb;
}

function relativeLuminance(color: string | Rgb) {
  const rgb = typeof color === 'string' ? parseColor(color).rgb : color;
  const channels = rgb
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );

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
  test('keeps secondary text readable on its standard surfaces', () => {
    for (const foreground of [colors.muted, colors.subtle]) {
      for (const background of [colors.background, colors.panel, colors.panelRaised]) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(contrastRatio(colors.muted, colors.surface1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.subtle, colors.crust)).toBeGreaterThanOrEqual(4.5);
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
