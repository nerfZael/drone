import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from '../../device-mesh-types';
import { CrossDeviceAssistantPolicyStore } from './policy-store';
import type { TargetWorkspaceRule } from './policy-types';

const MAX_FILE_BYTES = 192 * 1024;

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('workspace payload must be an object'), {
      code: 'INVALID_REQUEST',
    });
  return value as Record<string, any>;
}

function relativePath(value: unknown): string {
  const result = String(value ?? '.').trim() || '.';
  if (path.isAbsolute(result) || result.split(/[\\/]+/).includes('..'))
    throw Object.assign(new Error('path must stay inside the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return result;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function existingPath(root: string, relative: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(path.resolve(realRoot, relative));
  if (!isInside(realRoot, realTarget))
    throw Object.assign(new Error('resolved path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return realTarget;
}

async function writePath(root: string, relative: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relative);
  if (!isInside(realRoot, target))
    throw Object.assign(new Error('path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  let ancestor = path.dirname(target);
  while (ancestor !== realRoot) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      if (!isInside(realRoot, realAncestor)) throw new Error('outside root');
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw Object.assign(new Error('write path passes through an unsafe link'), {
          code: 'PATH_OUTSIDE_ROOT',
        });
      ancestor = path.dirname(ancestor);
    }
  }
  const existing = await fs.realpath(target).catch((error: any) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && !isInside(realRoot, existing))
    throw Object.assign(new Error('resolved path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return target;
}

function textResult(text: string, details: Record<string, unknown>) {
  return { text, details };
}

export function createWorkspaceCapability(
  policies: CrossDeviceAssistantPolicyStore,
): CapabilityHandler {
  return {
    descriptor: WORKSPACE_CAPABILITY,
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      const actor = object(payload.actor);
      const rule: TargetWorkspaceRule = {
        assistantHomeDeviceId: String(actor.assistantHomeDeviceId ?? ''),
        threadId: String(actor.threadId ?? ''),
        rootId: String(actor.rootId ?? ''),
        read: actor.read === true,
        write: actor.write === true,
      };
      if (
        rule.assistantHomeDeviceId !== context.sourceDevice.id ||
        !(await policies.exactTargetRule(rule))
      ) {
        throw Object.assign(new Error('thread workspace policy does not match this request'), {
          code: 'THREAD_POLICY_DENIED',
        });
      }
      const writing = operation === 'files.write';
      if ((writing && !rule.write) || (!writing && !rule.read))
        throw Object.assign(new Error('thread does not have this workspace permission'), {
          code: 'THREAD_POLICY_DENIED',
        });
      const root = await policies.root(rule.rootId);
      if (!root)
        throw Object.assign(new Error('configured workspace root was not found'), {
          code: 'ROOT_NOT_FOUND',
        });
      const requestedPath = relativePath(payload.path);

      if (operation === 'files.list') {
        const target = await existingPath(root.path, requestedPath);
        const limit = Math.max(1, Math.min(500, Number(payload.limit ?? 200)));
        const entries = (await fs.readdir(target, { withFileTypes: true }))
          .filter((entry) => payload.includeHidden === true || !entry.name.startsWith('.'))
          .sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
          )
          .slice(0, limit);
        const details = await Promise.all(
          entries.map(async (entry) => {
            const absolute = await existingPath(root.path, path.join(requestedPath, entry.name));
            const info = await fs.stat(absolute);
            return {
              path: path.relative(root.path, absolute) || '.',
              type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
              size: info.size,
              modifiedAt: info.mtime.toISOString(),
            };
          }),
        );
        return textResult(
          details
            .map((entry) => `${entry.type === 'directory' ? 'dir ' : 'file'} ${entry.path}`)
            .join('\n') || '(empty)',
          { entries: details, truncated: entries.length === limit },
        );
      }

      if (operation === 'files.read') {
        const target = await existingPath(root.path, requestedPath);
        const buffer = await fs.readFile(target);
        if (buffer.length > MAX_FILE_BYTES)
          throw Object.assign(new Error('file is too large'), { code: 'FILE_TOO_LARGE' });
        if (buffer.includes(0))
          throw Object.assign(new Error('file appears to be binary'), { code: 'BINARY_FILE' });
        const lines = buffer.toString('utf8').split(/\r?\n/);
        const offset = Math.max(0, Math.floor(Number(payload.offset ?? 0)));
        const limit = Math.max(1, Math.min(1000, Math.floor(Number(payload.limit ?? 200))));
        const selected = lines.slice(offset, offset + limit);
        const text = selected
          .map((line, index) => `${String(offset + index + 1).padStart(6, ' ')} | ${line}`)
          .join('\n');
        return textResult(text, {
          path: requestedPath,
          offset,
          lineCount: lines.length,
          returnedLines: selected.length,
          truncated: offset + limit < lines.length,
          sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        });
      }

      if (operation === 'files.write') {
        const content = String(payload.content ?? '');
        if (payload.mode !== 'create' && payload.mode !== 'overwrite')
          throw Object.assign(new Error('write mode must be create or overwrite'), {
            code: 'INVALID_REQUEST',
          });
        if (Buffer.byteLength(content) > MAX_FILE_BYTES)
          throw Object.assign(new Error('file content is too large'), { code: 'FILE_TOO_LARGE' });
        const target = await writePath(root.path, requestedPath);
        const exists = await fs
          .stat(target)
          .then(() => true)
          .catch((error: any) => {
            if (error?.code === 'ENOENT') return false;
            throw error;
          });
        if (payload.mode === 'create' && exists)
          throw Object.assign(new Error('file already exists'), { code: 'FILE_EXISTS' });
        if (payload.mode === 'overwrite' && !exists)
          throw Object.assign(new Error('file does not exist'), { code: 'FILE_NOT_FOUND' });
        if (!exists) await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
        return textResult(`wrote ${requestedPath}`, {
          path: requestedPath,
          bytes: Buffer.byteLength(content),
          created: !exists,
        });
      }

      if (operation === 'files.search') {
        const searchRoot = await existingPath(root.path, requestedPath);
        const query = String(payload.query ?? '');
        const limit = Math.max(1, Math.min(200, Math.floor(Number(payload.limit ?? 100))));
        const matches: Array<{ path: string; line?: number; preview?: string }> = [];
        const queue = [searchRoot];
        while (queue.length > 0 && matches.length < limit) {
          const current = queue.shift()!;
          for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || matches.length >= limit) continue;
            const absolute = await existingPath(
              root.path,
              path.join(path.relative(root.path, current), entry.name),
            );
            if (entry.isDirectory()) queue.push(absolute);
            else if (entry.isFile()) {
              const relative = path.relative(root.path, absolute);
              if (payload.mode === 'name') {
                if (relative.toLowerCase().includes(query.toLowerCase()))
                  matches.push({ path: relative });
              } else {
                const buffer = await fs.readFile(absolute);
                if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) continue;
                for (const [index, line] of buffer.toString('utf8').split(/\r?\n/).entries()) {
                  if (line.toLowerCase().includes(query.toLowerCase()))
                    matches.push({
                      path: relative,
                      line: index + 1,
                      preview: line.trim().slice(0, 300),
                    });
                  if (matches.length >= limit) break;
                }
              }
            }
          }
        }
        return textResult(
          matches
            .map((match) =>
              match.line ? `${match.path}:${match.line}:${match.preview}` : match.path,
            )
            .join('\n') || '(no matches)',
          { matches, truncated: matches.length === limit },
        );
      }

      throw Object.assign(new Error(`unsupported workspace operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
