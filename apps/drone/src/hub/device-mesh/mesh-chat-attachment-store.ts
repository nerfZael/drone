import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import {
  CHAT_ATTACHMENT_POLICY,
  validateChatAttachments,
  type ChatAttachmentValidationIssue,
} from '@drone/assistant-chat';

const MAX_ACTIVE_UPLOADS_PER_DEVICE = 16;
const MAX_ACTIVE_UPLOAD_BYTES_PER_DEVICE = 40 * 1024 * 1024;
const UPLOAD_TTL_MS = 30 * 60_000;

type Upload = {
  id: string;
  sourceDeviceId: string;
  droneId: string;
  chatName: string;
  name: string;
  mime: string;
  size: number;
  sha256: string | null;
  tokenHash: string;
  filePath: string;
  expiresAt: number;
  committed: boolean;
  busy: boolean;
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanId(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > 240) throw new Error(`${label} is required`);
  return text;
}

function attachmentName(value: unknown): string {
  const raw = String(value ?? '')
    .replace(/[\u0000\r\n\t]/gu, '')
    .replace(/\\/gu, '/')
    .trim();
  const name = raw.split('/').pop()?.trim() ?? '';
  if (!name) throw new Error('attachment name is required');
  return name.slice(0, 240);
}

function attachmentPolicyError(issue: ChatAttachmentValidationIssue): Error {
  if (issue.code === 'invalid_mime') {
    return new Error('attachment MIME type is invalid');
  }
  return new Error(
    `attachment size must be between 1 and ${CHAT_ATTACHMENT_POLICY.maxBytesEach} bytes`,
  );
}

export class MeshChatAttachmentStore {
  private readonly uploads = new Map<string, Upload>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly rootDir: string,
    private readonly authorized: (source: string) => Promise<boolean> = async () => true,
  ) {
    this.cleanupTimer = setInterval(() => void this.prune(), 5 * 60_000);
    this.cleanupTimer.unref?.();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.rootDir);
    // Preserve pre-upgrade partial files. New upload metadata permits restart recovery.
    for (const name of entries.filter((name) => /^mesh-upload-[a-zA-Z0-9-]+\.json$/.test(name))) {
      const upload = JSON.parse(await fs.readFile(path.join(this.rootDir, name), 'utf8')) as Upload;
      if (
        name !== `${upload.id}.json` ||
        !/^mesh-upload-[a-zA-Z0-9-]+$/.test(upload.id) ||
        typeof upload.sourceDeviceId !== 'string' ||
        !Number.isSafeInteger(upload.size) ||
        upload.size <= 0 ||
        upload.size > CHAT_ATTACHMENT_POLICY.maxBytesEach ||
        !Number.isFinite(upload.expiresAt) ||
        typeof upload.tokenHash !== 'string'
      ) {
        throw new Error('Invalid persisted upload metadata; existing files have been preserved');
      }
      upload.filePath = path.join(this.rootDir, `${upload.id}.part`);
      upload.busy = false;
      if (upload.expiresAt > Date.now()) this.uploads.set(upload.id, upload);
    }
  }

  async prepare(input: {
    sourceDeviceId: string;
    droneId: unknown;
    chatName: unknown;
    name: unknown;
    mime: unknown;
    size: unknown;
    sha256?: unknown;
  }) {
    await this.prune();
    const sourceDeviceId = cleanId(input.sourceDeviceId, 'source device');
    const droneId = cleanId(input.droneId, 'droneId');
    const chatName = cleanId(input.chatName, 'chatName');
    const name = attachmentName(input.name);
    const attachmentPolicy = validateChatAttachments([
      {
        name,
        mime: String(input.mime ?? ''),
        size: Number(input.size),
      },
    ]);
    if (!attachmentPolicy.ok) throw attachmentPolicyError(attachmentPolicy.issue);
    const { mime, size } = attachmentPolicy.attachments[0]!;
    const sha256 =
      String(input.sha256 ?? '')
        .trim()
        .toLowerCase() || null;
    if (sha256 && !/^[a-f0-9]{64}$/u.test(sha256))
      throw new Error('attachment sha256 must be a lowercase hexadecimal digest');
    const activeForSource = [...this.uploads.values()].filter(
      (upload) => upload.sourceDeviceId === sourceDeviceId,
    );
    if (activeForSource.length >= MAX_ACTIVE_UPLOADS_PER_DEVICE)
      throw new Error('too many active attachment uploads for this device');
    if (
      activeForSource.reduce((total, upload) => total + upload.size, 0) + size >
      MAX_ACTIVE_UPLOAD_BYTES_PER_DEVICE
    )
      throw new Error('active attachment uploads for this device exceed 40 MiB');
    const id = `mesh-upload-${crypto.randomUUID()}`;
    const token = crypto.randomBytes(32).toString('base64url');
    const filePath = path.join(this.rootDir, `${id}.part`);
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const handle = await fs.open(filePath, 'wx', 0o600);
    await handle.close();
    const upload: Upload = {
      id,
      sourceDeviceId,
      droneId,
      chatName,
      name,
      mime,
      size,
      sha256,
      tokenHash: crypto.createHash('sha256').update(token).digest('base64url'),
      filePath,
      expiresAt: Date.now() + UPLOAD_TTL_MS,
      committed: false,
      busy: false,
    };
    await this.persist(upload);
    this.uploads.set(id, upload);
    return {
      uploadId: id,
      uploadToken: token,
      expiresAt: new Date(upload.expiresAt).toISOString(),
    };
  }

  async writeHttp(uploadId: string, token: string, offset: unknown, request: http.IncomingMessage) {
    const upload = this.authorizedUpload(uploadId, token);
    if (!(await this.authorized(upload.sourceDeviceId)))
      throw Object.assign(new Error('Upload permission was revoked'), { code: 'UNAUTHORIZED' });
    this.beginOperation(upload);
    try {
      const parsedOffset = Number(offset);
      if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0)
        throw new Error('attachment offset is invalid');
      const stat = await fs.stat(upload.filePath);
      if (stat.size !== parsedOffset)
        throw Object.assign(
          new Error(`attachment offset mismatch: expected ${stat.size}, received ${parsedOffset}`),
          { code: 'TRANSFER_OFFSET_MISMATCH' },
        );
      const handle = await fs.open(upload.filePath, 'a');
      let written = 0;
      try {
        for await (const raw of request) {
          if (!(await this.authorized(upload.sourceDeviceId)))
            throw new Error('Upload permission was revoked');
          const chunk = Buffer.from(raw);
          if (parsedOffset + written + chunk.length > upload.size)
            throw new Error('attachment upload exceeds its declared size');
          await handle.write(chunk);
          written += chunk.length;
        }
        if (written === 0) throw new Error('attachment upload body is empty');
        await handle.sync();
      } finally {
        await handle.close();
      }
      upload.expiresAt = Date.now() + UPLOAD_TTL_MS;
      await this.persist(upload);
      return {
        uploadId: upload.id,
        offset: parsedOffset + written,
        complete: parsedOffset + written === upload.size,
      };
    } finally {
      upload.busy = false;
    }
  }

  async commit(sourceDeviceId: string, uploadId: unknown) {
    const upload = this.forSource(uploadId, sourceDeviceId);
    this.beginOperation(upload);
    try {
      const stat = await fs.stat(upload.filePath);
      if (stat.size !== upload.size)
        throw new Error(
          `attachment upload is incomplete: received ${stat.size} of ${upload.size} bytes`,
        );
      if (upload.sha256) {
        const digest = crypto
          .createHash('sha256')
          .update(await fs.readFile(upload.filePath))
          .digest('hex');
        if (!safeEqual(digest, upload.sha256)) throw new Error('attachment checksum did not match');
      }
      upload.committed = true;
      await this.persist(upload);
      return {
        attachmentId: upload.id,
        name: upload.name,
        mime: upload.mime,
        size: upload.size,
      };
    } finally {
      upload.busy = false;
    }
  }

  async abort(sourceDeviceId: string, uploadId: unknown): Promise<{ aborted: true }> {
    const upload = this.forSource(uploadId, sourceDeviceId);
    this.beginOperation(upload, true);
    try {
      await this.remove([upload.id]);
      return { aborted: true };
    } finally {
      upload.busy = false;
    }
  }

  async attachments(
    sourceDeviceId: string,
    droneId: string,
    chatName: string,
    attachmentIds: unknown,
  ) {
    const rawIds = Array.isArray(attachmentIds) ? attachmentIds : [];
    if (rawIds.length > CHAT_ATTACHMENT_POLICY.maxCount)
      throw new Error(`too many prompt attachments (max ${CHAT_ATTACHMENT_POLICY.maxCount})`);
    const ids = [...new Set(rawIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
    const uploads = ids.map((id) => this.forSource(id, sourceDeviceId));
    for (const upload of uploads) {
      if (!upload.committed) throw new Error(`attachment upload is not committed: ${upload.id}`);
      if (upload.droneId !== droneId || upload.chatName !== chatName)
        throw new Error('attachment upload belongs to another chat');
    }
    const attachmentPolicy = validateChatAttachments(uploads);
    if (!attachmentPolicy.ok) {
      if (attachmentPolicy.issue.code === 'attachments_too_large') {
        throw new Error('prompt attachments exceed 20 MiB in total');
      }
      if (attachmentPolicy.issue.code === 'too_many_attachments') {
        throw new Error(`too many prompt attachments (max ${CHAT_ATTACHMENT_POLICY.maxCount})`);
      }
      throw attachmentPolicyError(attachmentPolicy.issue);
    }
    return await Promise.all(
      uploads.map(async (upload) => ({
        id: upload.id,
        name: upload.name,
        mime: upload.mime,
        size: upload.size,
        dataBase64: (await fs.readFile(upload.filePath)).toString('base64'),
      })),
    );
  }

  async remove(attachmentIds: readonly string[]): Promise<void> {
    await Promise.all(
      attachmentIds.map(async (id) => {
        const upload = this.uploads.get(id);
        if (!upload) return;
        this.uploads.delete(id);
        await fs.rm(upload.filePath, { force: true });
        await fs.rm(path.join(this.rootDir, `${upload.id}.json`), { force: true });
      }),
    );
  }

  async close(): Promise<void> {
    clearInterval(this.cleanupTimer);
    const uploads = [...this.uploads.values()];
    this.uploads.clear();
    await Promise.all(uploads.map((upload) => this.persist(upload)));
  }

  private forSource(uploadId: unknown, sourceDeviceId: string): Upload {
    const upload = this.activeUpload(uploadId);
    if (upload.sourceDeviceId !== sourceDeviceId)
      throw Object.assign(new Error('attachment upload belongs to another device'), {
        code: 'PERMISSION_DENIED',
      });
    return upload;
  }

  private authorizedUpload(uploadId: unknown, token: string): Upload {
    const upload = this.activeUpload(uploadId);
    const tokenHash = crypto
      .createHash('sha256')
      .update(String(token ?? ''))
      .digest('base64url');
    if (!safeEqual(upload.tokenHash, tokenHash))
      throw Object.assign(new Error('attachment upload token is invalid'), {
        code: 'UNAUTHORIZED',
      });
    return upload;
  }

  private activeUpload(uploadId: unknown): Upload {
    const id = String(uploadId ?? '').trim();
    const upload = this.uploads.get(id);
    if (!upload || upload.expiresAt <= Date.now())
      throw Object.assign(new Error('attachment upload was not found or expired'), {
        code: 'NOT_FOUND',
      });
    return upload;
  }

  private async persist(upload: Upload): Promise<void> {
    const target = path.join(this.rootDir, `${upload.id}.json`);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ ...upload, busy: false }), { mode: 0o600 });
    await fs.rename(temporary, target);
  }

  private beginOperation(upload: Upload, allowCommitted = false): void {
    if (upload.committed && !allowCommitted)
      throw new Error('attachment upload is already committed');
    if (upload.busy)
      throw Object.assign(new Error('attachment upload is busy'), {
        code: 'TRANSFER_BUSY',
      });
    upload.busy = true;
  }

  private async prune(): Promise<void> {
    const expired = [...this.uploads.values()].filter(
      (upload) => !upload.busy && upload.expiresAt <= Date.now(),
    );
    // Expiry removes network authority, while preserving recoverable content on disk.
    for (const upload of expired) this.uploads.delete(upload.id);
  }
}
