import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import { readTerminalLogChunk } from '../src/host/terminal-log-reader';
import { decodeTmuxOutput } from '../src/terminal-control';

test('terminal log cursors preserve Unicode across every requested chunk size', async () => {
  const dir = await fs.mkdtemp('/tmp/terminal-log-test-');
  try {
    const text = '\nA€🙂é\x1b[31mRED\x1b[0m\r\n';
    await fs.writeFile(`${dir}/output`, text);
    for (let max = 1; max < 12; max++) {
      let offset = 0;
      let result = '';
      while (offset < Buffer.byteLength(text)) {
        const part = await readTerminalLogChunk(`${dir}/output`, offset, max);
        expect(part.nextOffset).toBeGreaterThan(offset);
        result += part.chunk;
        offset = part.nextOffset;
      }
      expect(result).toBe(text);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('partial producer writes wait for a complete character and truncation resets the cursor', async () => {
  const dir = await fs.mkdtemp('/tmp/terminal-log-test-');
  try {
    const bytes = Buffer.from('€');
    await fs.writeFile(`${dir}/output`, bytes.subarray(0, 1));
    expect(await readTerminalLogChunk(`${dir}/output`, 0, 1)).toEqual({ chunk: '', nextOffset: 0 });
    await fs.appendFile(`${dir}/output`, bytes.subarray(1));
    expect(await readTerminalLogChunk(`${dir}/output`, 0, 1)).toEqual({
      chunk: '€',
      nextOffset: 3,
    });
    await fs.writeFile(`${dir}/output`, '');
    expect(await readTerminalLogChunk(`${dir}/output`, 3, 100)).toEqual({
      chunk: '',
      nextOffset: 0,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('control-mode octal decoding preserves literal backslashes, ANSI, and partial UTF-8 bytes', () => {
  expect(decodeTmuxOutput(Buffer.from('\\134x\\015\\012\\033[31m')).toString()).toBe(
    '\\x\r\n\x1b[31m',
  );
  const euro = Buffer.from('€');
  expect(
    Buffer.concat([decodeTmuxOutput(euro.subarray(0, 1)), decodeTmuxOutput(euro.subarray(1))]),
  ).toEqual(euro);
});
