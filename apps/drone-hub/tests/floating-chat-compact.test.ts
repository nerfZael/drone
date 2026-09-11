import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('slim floating chat compact flag', () => {
  test('is set for every child of a narrow floating window, not only the transcript frame', () => {
    // The multi-chat column (Codex, Claude Code, …) renders its transcript
    // without the shared frame element, so keying the flag on that frame left
    // those floating chats auto-expanding run activity and changed files.
    const styles = read('../src/styles.css');
    const query = styles.indexOf('@container floating-chat (max-width: 560px)');
    expect(query).toBeGreaterThan(-1);
    const block = styles.slice(query, styles.indexOf('\n}\n', query));
    expect(block).toMatch(/\.dh-floating-chat > \* \{\s*--chat-compact: 1;/);
    expect(block).not.toMatch(/\.dh-chat-transcript \{\s*--chat-compact: 1;/);

    const hook = read('../src/droneHub/chat/use-compact-chat.ts');
    expect(hook).toContain("closest('.dh-floating-chat')");
    expect(hook).toContain("getPropertyValue('--chat-compact')");

    const column = read('../src/droneHub/app/GroupMultiChatColumn.tsx');
    expect(column).not.toContain('dh-chat-transcript');
  });
});
