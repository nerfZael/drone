import type { WorkspaceTarget, WorkspaceTargetCall, WorkspaceTargetDescriptor } from '@blip/tools';

import { runAssistantArtifactAction } from '../../assistant-artifacts';

function textResult(text: string, details: unknown) {
  return { content: [{ type: 'text' as const, text }], details };
}

export class AssistantArtifactsTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;

  constructor(private readonly threadId: string) {
    this.descriptor = {
      id: `artifacts:${threadId}`,
      kind: 'artifacts',
      label: 'Assistant artifacts',
      rootLabel: `artifacts:${threadId}`,
      capabilities: ['files.list', 'files.read', 'files.write', 'files.delete'],
    };
  }

  async execute(call: WorkspaceTargetCall) {
    if (call.tool === 'list_files') {
      const result = await runAssistantArtifactAction(this.threadId, { action: 'list' });
      const files = Array.isArray(result.files) ? result.files : [];
      return textResult(files.map((file: any) => `file ${file.path}`).join('\n') || '(empty)', {
        entries: files,
        truncated: false,
      });
    }
    if (call.tool === 'read_file') {
      const result = await runAssistantArtifactAction(this.threadId, { action: 'read', path: call.args.path });
      const file = result.file;
      if (file?.binary) throw new Error('file appears to be binary');
      return textResult(String(file?.content ?? ''), {
        path: file.path,
        lineCount: String(file?.content ?? '').split(/\r?\n/).length,
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
      });
      return textResult(`wrote ${result.file.path}`, {
        path: result.file.path,
        bytes: result.file.size,
        revision: result.file.revision,
      });
    }
    if (call.tool === 'delete_file') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'delete',
        path: call.args.path,
      });
      return textResult(`deleted ${String(call.args.path ?? '')}`, result);
    }
    throw new Error(`assistant artifacts target does not support ${call.tool}`);
  }
}
