import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateDeviceIdentity } from '../src/hub/device-mesh/device-identity';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { MeshChatAttachmentStore } from '../src/hub/device-mesh/mesh-chat-attachment-store';

test('opening an existing mesh retains identity, membership, and unrelated content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-http-upgrade-'));
  try {
    const identity = await loadOrCreateDeviceIdentity(root);
    const statePath = path.join(root, 'state.json');
    const store = new DeviceMeshStore(statePath, identity);
    const before = await store.read();
    const content = {
      transcripts: [{ id: 'message-1', text: 'Do not lose this transcript' }],
      drones: [{ id: 'drone-1' }],
    };
    await fs.writeFile(path.join(root, 'content-fixture.json'), JSON.stringify(content));
    const keyBefore = await fs.readFile(path.join(root, 'identity-private.pem'), 'utf8');
    const reopened = new DeviceMeshStore(statePath, await loadOrCreateDeviceIdentity(root));
    expect(await reopened.read()).toEqual(before);
    expect(await fs.readFile(path.join(root, 'identity-private.pem'), 'utf8')).toBe(keyBefore);
    expect(JSON.parse(await fs.readFile(path.join(root, 'content-fixture.json'), 'utf8'))).toEqual(
      content,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a missing key never recreates an identity for an existing installation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-http-missing-key-'));
  try {
    await fs.writeFile(path.join(root, 'state.json'), '{"existing":"membership"}');
    await expect(loadOrCreateDeviceIdentity(root)).rejects.toThrow('preserved');
    expect(await fs.readFile(path.join(root, 'state.json'), 'utf8')).toBe(
      '{"existing":"membership"}',
    );
    expect(await fs.stat(path.join(root, 'identity-private.pem')).catch(() => null)).toBeNull();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('repeated reads of corrupt membership preserve the original bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-http-corrupt-state-'));
  try {
    const identity = await loadOrCreateDeviceIdentity(root);
    const statePath = path.join(root, 'state.json');
    const corrupt = '{"devices":unfinished';
    await fs.writeFile(statePath, corrupt);
    const store = new DeviceMeshStore(statePath, identity);
    await expect(store.read()).rejects.toThrow();
    await expect(store.read()).rejects.toThrow();
    expect(await fs.readFile(statePath, 'utf8')).toBe(corrupt);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('attachment restart preserves old partial files and new upload sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-http-uploads-'));
  const first = new MeshChatAttachmentStore(root);
  let second: MeshChatAttachmentStore | undefined;
  try {
    await fs.writeFile(path.join(root, 'mesh-upload-old.part'), 'recoverable bytes');
    await first.initialize();
    const prepared = await first.prepare({
      sourceDeviceId: 'phone',
      droneId: 'drone',
      chatName: 'default',
      name: 'a.txt',
      mime: 'text/plain',
      size: 3,
    });
    await first.close();
    second = new MeshChatAttachmentStore(root);
    await second.initialize();
    expect(await fs.readFile(path.join(root, 'mesh-upload-old.part'), 'utf8')).toBe(
      'recoverable bytes',
    );
    await expect(second.commit('phone', prepared.uploadId)).rejects.toThrow('incomplete');
    expect(await fs.stat(path.join(root, `${prepared.uploadId}.part`))).toBeTruthy();
  } finally {
    await first.close();
    await second?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
