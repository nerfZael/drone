import type { WorkspaceTarget, WorkspaceTargetCall, WorkspaceTargetDescriptor } from '@blip/tools';

import {
  createAssistantArtifactTransferAdapter,
  listAssistantArtifactEntries,
  runAssistantArtifactAction,
} from '../../assistant-artifacts';

function textResult(text: string, details: unknown) {
  return { content: [{ type: 'text' as const, text }], details };
}

export class AssistantArtifactsTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;
  readonly transfer;

  constructor(private readonly threadId: string) {
    this.descriptor = {
      id: `artifacts:${threadId}`,
      kind: 'artifacts',
      label: 'Assistant artifacts',
      rootLabel: `artifacts:${threadId}`,
      capabilities: ['files.list', 'files.read', 'files.write', 'files.delete', 'directories.create'],
    };
    this.transfer = createAssistantArtifactTransferAdapter(threadId);
  }

  async execute(call: WorkspaceTargetCall) {
    if (call.tool === 'list_files') {
      const result = await listAssistantArtifactEntries(this.threadId, call.args.path, call.args.limit);
      return textResult(result.entries.map((entry) => `${entry.type === 'directory' ? 'dir ' : 'file'} ${entry.path}`).join('\n') || '(empty)', result);
    }
    if (call.tool === 'read_file') {
      const result = await runAssistantArtifactAction(this.threadId, { action: 'read', path: call.args.path });
      const file = result.file;
      if (file?.binary) throw new Error('file appears to be binary');
      const lines = String(file?.content ?? '').split(/\r?\n/);
      const rawOffset = Number(call.args.offset);
      const rawLimit = Number(call.args.limit);
      const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.min(lines.length, Math.floor(rawOffset))) : 0;
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.floor(rawLimit))) : 200;
      const selected = lines.slice(offset, offset + limit);
      const truncated = offset + selected.length < lines.length;
      const text = selected.map((line, index) => `${String(offset + index + 1).padStart(6, ' ')} | ${line}`).join('\n');
      return textResult(`${text}${truncated ? `\n[continue with offset ${offset + limit}]` : ''}`, {
        path: file.path,
        offset,
        lineCount: lines.length,
        returnedLines: selected.length,
        truncated,
        sha256: file.revision,
        revision: file.revision,
      });
    }
    if (call.tool === 'write_file') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'write',
        path: call.args.path,
        content: call.args.content,
        baseRevision: call.args.baseHash,
        mode: call.args.mode,
      });
      return textResult(`wrote ${result.file.path}`, {
        path: result.file.path,
        bytes: result.file.size,
        created: call.args.mode === 'create',
        revision: result.file.revision,
      });
    }
    if (call.tool === 'delete_file') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'delete',
        path: call.args.path,
        baseRevision: call.args.baseHash,
      });
      return textResult(`deleted ${String(call.args.path ?? '')}`, result);
    }
    if (call.tool === 'create_directory') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'create_directory',
        path: call.args.path,
        recursive: call.args.recursive,
      });
      return textResult(`created directory ${result.path}`, {
        path: result.path,
        recursive: result.recursive,
      });
    }
    throw new Error(`assistant artifacts target does not support ${call.tool}`);
  }
}
