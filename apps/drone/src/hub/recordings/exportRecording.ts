import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import type { ServerResponse } from 'node:http';
import type { RecordingStore } from './RecordingStore';

/** Stream the bundle; exporting a long call must not buffer its audio in the renderer. */
export async function exportRecording(store: RecordingStore, id: string, response: ServerResponse) {
  const directory = await store.directory(id);
  const files = ['transcript.md', 'transcript.json'];
  for (const name of ['microphone.flac', 'system.flac']) {
    try { await fs.stat(await store.file(directory, name)); files.push(name); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const file of files) await store.file(directory, file);
  const child = spawn('tar', ['-czf', '-', '--', ...files.map(file => `${id}/${file}`)], { cwd: path.dirname(directory), stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(errors || `Export failed (${code}).`)));
  });
  response.setHeader('content-type', 'application/gzip');
  response.setHeader('content-disposition', `attachment; filename="${id}.tar.gz"`);
  response.setHeader('cache-control', 'no-store');
  try { await Promise.all([pipeline(child.stdout, response), completed]); }
  finally { if (child.exitCode === null) child.kill('SIGTERM'); }
}
