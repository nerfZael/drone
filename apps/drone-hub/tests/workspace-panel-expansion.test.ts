import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  EXPANSION_MAX_CODE_COLUMNS,
  EXPANSION_NEIGHBOUR_STRIP_PX,
  expansionKeyForPanel,
  chatReadingWidthPx,
  planPanelExpansion,
  targetCodeColumns,
  visualLineLength,
} from '../src/droneHub/app/workspace-panel-expansion';

const workspace = { left: 0, top: 0, width: 1600, height: 1000 };

describe('planPanelExpansion', () => {
  test('a thin row under the canvas grows upward to 40% of the height, keeping its bottom edge', () => {
    const plan = planPanelExpansion({ slot: { left: 800, top: 940, width: 600, height: 60 }, workspace, extraWidth: null });
    expect(plan).toEqual({ axis: 'y', rect: { left: 800, top: 600, width: 600, height: 400 } });
  });

  test('a thin column on the right grows left, keeping its right edge', () => {
    const plan = planPanelExpansion({ slot: { left: 1550, top: 0, width: 50, height: 1000 }, workspace, extraWidth: null });
    expect(plan).toEqual({ axis: 'x', rect: { left: 960, top: 0, width: 640, height: 1000 } });
  });

  test('measured content only widens, toward the side with more room', () => {
    const plan = planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 220 });
    expect(plan).toEqual({ axis: 'x', rect: { left: 0, top: 0, width: 720, height: 1000 } });
  });

  test('never covers the whole workspace', () => {
    const plan = planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 5000 });
    expect(plan?.rect.width).toBe(workspace.width - EXPANSION_NEIGHBOUR_STRIP_PX);
  });

  test('stays inside the workspace when growing from the middle', () => {
    const plan = planPanelExpansion({ slot: { left: 900, top: 0, width: 400, height: 500 }, workspace, extraWidth: 600 });
    expect(plan!.rect.left + plan!.rect.width).toBeLessThanOrEqual(workspace.width);
    expect(plan!.rect.width).toBe(1000);
  });

  test('does nothing when the content fits or the window is already large', () => {
    expect(planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 0 })).toBeNull();
    expect(planPanelExpansion({ slot: { left: 0, top: 0, width: 900, height: 1000 }, workspace, extraWidth: null })).toBeNull();
  });
});

describe('content-fit width', () => {
  test('ignores the longest 5% of lines and blank lines', () => {
    const lengths = [...Array(95).fill(80), ...Array(5).fill(3000), ...Array(50).fill(0)];
    expect(targetCodeColumns(lengths)).toBe(80);
  });

  test('caps the width even when most lines are long', () => {
    expect(targetCodeColumns(Array(20).fill(400))).toBe(EXPANSION_MAX_CODE_COLUMNS);
  });

  test('expands tabs and ignores trailing whitespace', () => {
    expect(visualLineLength('\tab  ', 4)).toBe(6);
    expect(visualLineLength('a\tb', 4)).toBe(5);
  });
});

test('file and chat windows share one setting per kind', () => {
  expect(expansionKeyForPanel('file-tab:abc')).toBe('file');
  expect(expansionKeyForPanel('side-chat:plan')).toBe('chat');
  expect(expansionKeyForPanel('agent-chat')).toBe('chat');
  expect(expansionKeyForPanel('tool:terminal')).toBe('tool:terminal');
});

describe('chat reading width', () => {
  // happy-dom has no layout: elements get fixed widths, and the prose cap resolves to 600px.
  function chatWindow({ group = 500, scroller = 488, transcript = 488, replies = [] as number[], mounted = true } = {}) {
    const document = new Window().document;
    const sized = (width: number, className = '') => {
      const element = document.createElement('div');
      element.className = className;
      Object.defineProperty(element, 'clientWidth', { value: width });
      Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width }) });
      return element;
    };
    const root = sized(group);
    if (mounted) {
      const scroll = sized(scroller);
      scroll.setAttribute('data-chat-transcript-scroll', 'true');
      const content = sized(transcript, 'dh-chat-transcript');
      for (const width of replies) content.appendChild(sized(width, 'dh-markdown dh-markdown--transcript dh-markdown--agent'));
      scroll.appendChild(content);
      root.appendChild(scroll);
    }
    const createElement = document.createElement.bind(document);
    Object.defineProperty(document, 'createElement', {
      value: (tagName: string) => {
        const element = createElement(tagName);
        Object.defineProperty(element, 'getBoundingClientRect', {
          value: () => ({ width: element.style.width === 'var(--chat-prose-max)' ? 600 : 0 }),
        });
        return element;
      },
    });
    return root as unknown as HTMLElement;
  }

  test('is the prose cap plus what sits beside the widest reply and around the transcript', () => {
    // 12px of scrollbar outside, 48px of padding beside the 440px reply.
    const root = chatWindow({ replies: [300, 440] });
    expect(chatReadingWidthPx(root)).toBe(12 + 48 + 600);
    expect(root.querySelectorAll('[style*="chat-prose-max"]')).toHaveLength(0);
  });

  test('a chat without replies yet uses the transcript padding', () => {
    expect(chatReadingWidthPx(chatWindow())).toBe(12 + 48 + 600);
  });

  test('a chat that is not on screen asks for nothing', () => {
    expect(chatReadingWidthPx(chatWindow({ mounted: false }))).toBeNull();
    expect(chatReadingWidthPx(chatWindow({ scroller: 0 }))).toBeNull();
  });
});
