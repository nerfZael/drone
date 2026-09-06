import { describe, expect, test } from 'bun:test';
import { renderNativeMermaid } from '../src/local-assistant/native-mermaid';

const FLOWCHART = `flowchart LR
    Click[Click chat] --> Select[Update selected drone and chat]
    Select --> Docker[Docker size]
    Select --> PRs[Open pull requests]
    Select -. if unread .-> Read[Mark read]
    Select --> Kind{Agent type}
    Kind -->|Native agent| Native[Native bootstrap + history]

    classDef secondary fill:#f4f4f4,stroke:#999,color:#333;
    class Docker,PRs secondary;`;

describe('native Mermaid rendering', () => {
  test('renders flowcharts to sized React Native-safe SVG', () => {
    const result = renderNativeMermaid(FLOWCHART);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.xml).toContain('<svg');
    expect(result.xml).toContain('Docker size');
    expect(result.xml).not.toContain('<style>');
    expect(result.xml).not.toContain('var(--');
    expect(result.xml).not.toContain('https://fonts.googleapis.com');
    expect(result.xml).not.toContain('data-id="class"');
  });

  test('applies safe Mermaid classDef colors to assigned nodes', () => {
    const result = renderNativeMermaid(FLOWCHART);
    const dockerGroup = /<g class="node"[^>]*data-id="Docker"[^>]*>([\s\S]*?)<\/g>/.exec(
      result.xml,
    )?.[1];
    expect(dockerGroup).toContain('fill="#f4f4f4"');
    expect(dockerGroup).toContain('stroke="#999"');
    expect(dockerGroup).toContain('fill="#333"');
  });

  test.each([
    ['state', 'stateDiagram-v2\n[*] --> Idle\nIdle --> Running', 'Running'],
    ['sequence', 'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi', 'Hello'],
    ['class', 'classDiagram\nclass Animal {\n+String name\n+move()\n}\nAnimal <|-- Dog', 'move()'],
    ['ER', 'erDiagram\nCUSTOMER ||--o{ ORDER : places', 'CUSTOMER'],
    [
      'XY chart',
      'xychart-beta\nx-axis [Jan, Feb, Mar]\ny-axis "Sales" 0 --> 100\nbar [20, 50, 80]',
      'Sales',
    ],
  ])('renders %s diagrams without dropping their content', (_type, source, expectedText) => {
    const result = renderNativeMermaid(source);
    expect(result.xml).toContain(expectedText);
    expect(result.xml).not.toContain('var(--');
  });

  test.each([
    ['sequence', 'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi'],
    ['class inheritance', 'classDiagram\nAnimal <|-- Dog'],
    ['bidirectional flowchart', 'flowchart LR\nA <--> B'],
  ])('keeps %s marker orientations compatible with Android', (_type, source) => {
    const { xml } = renderNativeMermaid(source);
    expect(xml).not.toContain('auto-start-reverse');
    for (const marker of xml.matchAll(/<marker\b[^>]*\borient="([^"]+)"/g)) {
      const orientation = marker[1]!;
      expect(orientation === 'auto' || Number.isFinite(Number(orientation))).toBe(true);
    }
  });

  test('preserves start-arrow reversal without reversing end arrows', () => {
    const { xml } = renderNativeMermaid('classDiagram\nAnimal <|-- Dog\nCat --|> Animal');
    expect(xml).toContain('marker-start="url(#cls-inherit-native-start)"');
    expect(xml).toContain('marker-end="url(#cls-inherit)"');
    const reversed = /<marker id="cls-inherit-native-start"[^>]*>([\s\S]*?)<\/marker>/.exec(
      xml,
    )?.[1];
    expect(reversed).toContain('transform="rotate(180 12 5)"');
    const forward = /<marker id="cls-inherit"[^>]*>([\s\S]*?)<\/marker>/.exec(xml)?.[1];
    expect(forward).not.toContain('rotate(180');
  });

  test('drops unsafe flowchart style directives before rendering', () => {
    const result = renderNativeMermaid(
      'flowchart LR\nA[Start] --> B[End]\nstyle A fill:url(https://example.com/x)\nlinkStyle 0 stroke:url(https://example.com/y)',
    );
    expect(result.xml).not.toContain('url(https:');
    expect(result.xml).not.toContain('example.com');
  });

  test('rejects excessively large diagrams', () => {
    expect(() => renderNativeMermaid(`flowchart LR\n${'A-->B\n'.repeat(10_000)}`)).toThrow(
      'too large',
    );
  });

  test('keeps label markup inert', () => {
    const result = renderNativeMermaid('flowchart LR\nA["<script>alert(1)</script>"] --> B');
    expect(result.xml).not.toContain('<script>');
    expect(result.xml).toContain('&lt;script&gt;');
  });
});
