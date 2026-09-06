import { renderMermaidSVG } from 'beautiful-mermaid';

export type NativeMermaidSvg = {
  height: number;
  width: number;
  xml: string;
};

type MermaidClassStyle = {
  fill?: string;
  stroke?: string;
  color?: string;
  strokeWidth?: string;
};

const MAX_NATIVE_MERMAID_SOURCE_LENGTH = 20_000;
const MAX_NATIVE_MERMAID_SOURCE_LINES = 500;

const NATIVE_COLORS: Record<string, string> = {
  'var(--bg)': '#1e1e2e',
  'var(--fg)': '#cdd6f4',
  'var(--_text)': '#cdd6f4',
  'var(--_text-sec)': '#a6adc8',
  'var(--_text-muted)': '#9399b2',
  'var(--_text-faint)': '#6c7086',
  'var(--_line)': '#9399b2',
  'var(--_arrow)': '#cba6f7',
  'var(--_node-fill)': '#252536',
  'var(--_node-stroke)': '#585b70',
  'var(--_group-fill)': '#1e1e2e',
  'var(--_group-hdr)': '#282839',
  'var(--_inner-stroke)': '#3d3d50',
  'var(--_key-badge)': '#343447',
};

function sourceForNativeRenderer(source: string): string {
  const firstStatement =
    source
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('%%'))
      ?.toLowerCase() ?? '';
  const supportsFlowchartStyles =
    /^(?:graph|flowchart)\b/.test(firstStatement) || firstStatement.startsWith('statediagram');
  if (!supportsFlowchartStyles) return source;

  return source
    .split('\n')
    .filter((line) => !/^\s*(?:classDef|class|style|linkStyle)\s+/.test(line))
    .join('\n');
}

function parseDimensions(svg: string): { width: number; height: number } {
  const match = /\bviewBox="[^"]*?0\s+0\s+([\d.]+)\s+([\d.]+)"/i.exec(svg);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('The diagram renderer returned an invalid SVG size.');
  }
  return { width, height };
}

function parseClassStyles(source: string): Map<string, MermaidClassStyle> {
  const styles = new Map<string, MermaidClassStyle>();
  for (const match of source.matchAll(/^\s*classDef\s+([A-Za-z0-9_-]+)\s+(.+?)\s*;?\s*$/gm)) {
    const style: MermaidClassStyle = {};
    for (const declaration of String(match[2] ?? '')
      .replace(/;$/, '')
      .split(',')) {
      const [rawName, rawValue] = declaration.split(':', 2);
      const name = String(rawName ?? '')
        .trim()
        .toLowerCase();
      const value = String(rawValue ?? '').trim();
      if (
        (name === 'fill' || name === 'stroke' || name === 'color') &&
        /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
      ) {
        style[name] = value;
      } else if (name === 'stroke-width' && /^\d+(?:\.\d+)?(?:px)?$/i.test(value)) {
        const strokeWidth = Number(value.replace(/px$/i, ''));
        if (strokeWidth <= 20) style.strokeWidth = String(strokeWidth);
      }
    }
    if (Object.keys(style).length > 0) styles.set(String(match[1]), style);
  }
  return styles;
}

function parseClassAssignments(source: string): Map<string, string[]> {
  const assignments = new Map<string, string[]>();
  for (const match of source.matchAll(
    /^\s*class\s+([A-Za-z0-9_,-]+)\s+([A-Za-z0-9_-]+)\s*;?\s*$/gm,
  )) {
    const className = String(match[2]);
    for (const id of String(match[1] ?? '').split(',')) {
      if (!id) continue;
      assignments.set(id, [...(assignments.get(id) ?? []), className]);
    }
  }
  return assignments;
}

function setAttribute(tag: string, name: string, value: string): string {
  const attribute = new RegExp(`\\s${name}="[^"]*"`, 'i');
  if (attribute.test(tag)) return tag.replace(attribute, ` ${name}="${value}"`);
  return tag.replace(/\/?>$/, (ending) => ` ${name}="${value}"${ending}`);
}

function mergeClassStyles(
  classNames: string[],
  styles: ReadonlyMap<string, MermaidClassStyle>,
): MermaidClassStyle {
  const merged: MermaidClassStyle = {};
  for (const className of classNames) Object.assign(merged, styles.get(className));
  return merged;
}

function applyNodeClassStyles(svg: string, source: string): string {
  const styles = parseClassStyles(source);
  const assignments = parseClassAssignments(source);
  if (styles.size === 0 || assignments.size === 0) return svg;

  return svg.replace(
    /<g class="node"[^>]*\bdata-id="([A-Za-z0-9_-]+)"[^>]*>[\s\S]*?<\/g>/g,
    (group, id: string) => {
      const classNames = assignments.get(id);
      if (!classNames) return group;
      const style = mergeClassStyles(classNames, styles);
      let next = String(group);
      next = next.replace(/<(?:rect|polygon|ellipse|circle|path)\b[^>]*>/, (shape) => {
        let styledShape = String(shape);
        if (style.fill) styledShape = setAttribute(styledShape, 'fill', style.fill);
        if (style.stroke) styledShape = setAttribute(styledShape, 'stroke', style.stroke);
        if (style.strokeWidth) {
          styledShape = setAttribute(styledShape, 'stroke-width', style.strokeWidth);
        }
        return styledShape;
      });
      if (style.color) {
        next = next.replace(/<text\b[^>]*>/, (text) =>
          setAttribute(String(text), 'fill', style.color!),
        );
      }
      return next;
    },
  );
}

function normalizeNativeMarkerOrientations(svg: string): string {
  // Android's MarkerView accepts only "auto" or a number. SVG 2's
  // "auto-start-reverse" otherwise throws NumberFormatException on the UI thread.
  // Keep the normal marker for ends, and rotate a separate copy for starts.
  const reversedIds = new Map<string, string>();
  const startIds = new Set(
    Array.from(svg.matchAll(/\bmarker-start="url\(#([^)"]+)\)"/g), (match) => match[1]!),
  );
  const next = svg.replace(
    /<marker\b([^>]*)>([\s\S]*?)<\/marker>/g,
    (marker, attributes: string, contents: string) => {
      if (!/\borient="auto-start-reverse"/.test(attributes)) return marker;
      const normalAttributes = attributes.replace('orient="auto-start-reverse"', 'orient="auto"');
      const normal = `<marker${normalAttributes}>${contents}</marker>`;
      const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
      if (!id || !startIds.has(id)) return normal;
      const refX = Number(/\brefX="([^"]+)"/.exec(attributes)?.[1] ?? 0);
      const refY = Number(/\brefY="([^"]+)"/.exec(attributes)?.[1] ?? 0);
      if (!Number.isFinite(refX) || !Number.isFinite(refY)) {
        throw new Error('The diagram renderer returned unsupported SVG marker coordinates.');
      }
      const reversedId = `${id}-native-start`;
      reversedIds.set(id, reversedId);
      const reversedAttributes = normalAttributes.replace(`id="${id}"`, `id="${reversedId}"`);
      return `${normal}<marker${reversedAttributes}><g transform="rotate(180 ${refX} ${refY})">${contents}</g></marker>`;
    },
  );
  return next.replace(/\bmarker-start="url\(#([^)"]+)\)"/g, (attribute, id: string) => {
    const reversedId = reversedIds.get(id);
    return reversedId ? `marker-start="url(#${reversedId})"` : attribute;
  });
}

function prepareForReactNativeSvg(svg: string, source: string): string {
  if (
    /<(?:a|animate|animateMotion|animateTransform|foreignObject|iframe|image|script|set)\b/i.test(
      svg,
    )
  ) {
    throw new Error('The diagram renderer returned unsupported SVG content.');
  }
  let next = svg.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  next = next.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  next = next.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  next = next.replace(/\s(?:href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  for (const [variable, color] of Object.entries(NATIVE_COLORS)) {
    next = next.replaceAll(variable, color);
  }
  if (next.includes('var(--') || /url\(\s*(?!#)/i.test(next)) {
    throw new Error('The diagram renderer returned unsupported SVG styling.');
  }
  return normalizeNativeMarkerOrientations(applyNodeClassStyles(next, source));
}

export function renderNativeMermaid(source: string): NativeMermaidSvg {
  if (
    source.length > MAX_NATIVE_MERMAID_SOURCE_LENGTH ||
    source.split('\n').length > MAX_NATIVE_MERMAID_SOURCE_LINES
  ) {
    throw new Error('This Mermaid diagram is too large to render.');
  }
  const svg = renderMermaidSVG(sourceForNativeRenderer(source), {
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    line: '#9399b2',
    accent: '#cba6f7',
    muted: '#a6adc8',
    surface: '#252536',
    border: '#585b70',
    font: 'sans-serif',
    transparent: true,
    padding: 28,
  });
  const dimensions = parseDimensions(svg);
  return {
    ...dimensions,
    xml: prepareForReactNativeSvg(svg, source),
  };
}
