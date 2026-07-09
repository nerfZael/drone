import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  listAssistantArtifactFiles,
  readAssistantArtifactBytes,
  readAssistantArtifactFile,
  saveAssistantArtifactUploads,
} from '../src/hub/assistant-artifacts';

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-artifact-uploads-'));
  process.env.DRONE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.DRONE_DATA_DIR;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('assistant artifact uploads', () => {
  test('saves uploaded images as thread files and reads image bytes', async () => {
    const refs = await saveAssistantArtifactUploads('thread-1', [
      {
        name: 'screen.png',
        mime: 'image/png',
        size: 4,
        dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    ]);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toContain('uploads/');
    expect(refs[0]?.mime).toBe('image/png');

    const files = await listAssistantArtifactFiles('thread-1');
    expect(files.map((file) => file.path)).toEqual([refs[0]?.path]);
    expect(files[0]?.mimeType).toBe('image/png');
    expect(files[0]?.binary).toBe(true);

    const file = await readAssistantArtifactFile('thread-1', refs[0]?.path);
    expect(file.content).toBe('');
    expect(file.contentBase64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));

    const bytes = await readAssistantArtifactBytes('thread-1', refs[0]?.path);
    expect(bytes.mime).toBe('image/png');
    expect(bytes.dataBase64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
  });

  test('infers image mime from uploaded image file extension', async () => {
    const refs = await saveAssistantArtifactUploads('thread-2', [
      {
        name: 'photo.jpg',
        mime: 'application/octet-stream',
        size: 3,
        dataBase64: Buffer.from([5, 6, 7]).toString('base64'),
      },
    ]);

    expect(refs[0]?.mime).toBe('image/jpeg');
    expect(refs[0]?.mimeType).toBe('image/jpeg');
  });

  test('treats common binary uploads as binary thread files', async () => {
    const refs = await saveAssistantArtifactUploads('thread-3', [
      {
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 8,
        dataBase64: Buffer.from('%PDF-1.7').toString('base64'),
      },
    ]);

    const file = await readAssistantArtifactFile('thread-3', refs[0]?.path);
    expect(file.mimeType).toBe('application/pdf');
    expect(file.binary).toBe(true);
    expect(file.content).toBe('');
    expect(file.contentBase64).toBe(Buffer.from('%PDF-1.7').toString('base64'));
  });

  test('rejects too many uploads instead of silently dropping extras', async () => {
    const payload = Array.from({ length: 9 }, (_, index) => ({
      name: `file-${index}.txt`,
      mime: 'text/plain',
      size: 1,
      dataBase64: Buffer.from('x').toString('base64'),
    }));

    await expect(saveAssistantArtifactUploads('thread-4', payload)).rejects.toThrow(/too many attachments/i);
  });

  test('rejects invalid base64 payloads', async () => {
    await expect(
      saveAssistantArtifactUploads('thread-5', [
        {
          name: 'bad.txt',
          mime: 'text/plain',
          size: 1,
          dataBase64: 'abc$',
        },
      ]),
    ).rejects.toThrow(/base64/i);
  });

  test('does not leave partial uploads when a batch is invalid', async () => {
    await expect(
      saveAssistantArtifactUploads('thread-6', [
        {
          name: 'ok.txt',
          mime: 'text/plain',
          size: 2,
          dataBase64: Buffer.from('ok').toString('base64'),
        },
        {
          name: 'bad.txt',
          mime: 'text/plain',
          size: 1,
          dataBase64: 'bad!',
        },
      ]),
    ).rejects.toThrow(/base64/i);

    expect(await listAssistantArtifactFiles('thread-6')).toEqual([]);
  });
});
