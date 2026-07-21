import type { WorkspaceTarget, WorkspaceTargetCall, WorkspaceTargetDescriptor } from '@blip/tools';

import {
  createAssistantArtifactTransferAdapter,
  listAssistantArtifactEntries,
  normalizeAssistantArtifactPath,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  searchAssistantArtifactFiles,
  statAssistantArtifactPath,
} from '../../assistant-artifacts';

function textResult(text: string, details: unknown) {
  return { content: [{ type: 'text' as const, text }], details };
}

export class AssistantArtifactsTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;
  readonly transfer;

  constructor(
    private readonly threadId: string,
    private readonly patchEngine: {
      parse: (patch: string) => Array<
        | { type: 'add'; path: string; lines: string[] }
        | { type: 'delete'; path: string }
        | { type: 'update'; path: string; moveTo?: string; hunks: any[][] }
      >;
      applyHunks: (content: string, hunks: any[][], filePath: string) => string;
    },
    private readonly beforeMutation?: () => Promise<void>,
  ) {
    this.descriptor = {
      id: `artifacts:${threadId}`,
      kind: 'artifacts',
      label: 'Artifacts',
      rootLabel: `artifacts:${threadId}`,
      capabilities: [
        'files.list',
        'files.read',
        'files.search',
        'files.write',
        'files.delete',
        'files.move',
        'directories.create',
        'directories.delete',
        'patch.apply',
      ],
    };
    this.transfer = createAssistantArtifactTransferAdapter(threadId, beforeMutation);
  }

  async execute(call: WorkspaceTargetCall) {
    if (
      call.tool === 'write_file' ||
      call.tool === 'delete_file' ||
      call.tool === 'move_path' ||
      call.tool === 'create_directory' ||
      call.tool === 'delete_directory' ||
      call.tool === 'apply_patch'
    ) {
      await this.beforeMutation?.();
    }
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
    if (call.tool === 'search_files') {
      const result = await searchAssistantArtifactFiles(this.threadId, call.args);
      const text = result.matches
        .map((match) =>
          typeof match === 'string'
            ? match
            : `${match.path}:${match.line}:${match.preview}`,
        )
        .join('\n');
      return textResult(text || '(no matches)', result);
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
    if (call.tool === 'move_path') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'move',
        from: call.args.from,
        to: call.args.to,
        overwrite: call.args.overwrite,
      });
      return textResult(`moved ${result.from} -> ${result.to}`, result);
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
    if (call.tool === 'delete_directory') {
      const result = await runAssistantArtifactAction(this.threadId, {
        action: 'delete_directory',
        path: call.args.path,
        recursive: call.args.recursive,
      });
      return textResult(`deleted directory ${result.path}`, result);
    }
    if (call.tool === 'apply_patch') {
      const operations = this.patchEngine.parse(String(call.args.patch ?? ''));
      const planned: Array<{
        operation: (typeof operations)[number];
        path: string;
        moveTo?: string;
        content?: string;
        revision?: string;
      }> = [];
      for (const operation of operations) {
        const operationPath = normalizeAssistantArtifactPath(operation.path);
        if (operation.type === 'add') {
          if (await statAssistantArtifactPath(this.threadId, operationPath)) {
            throw new Error(`file already exists: ${operationPath}`);
          }
          planned.push({ operation, path: operationPath, content: operation.lines.join('\n') });
          continue;
        }
        if (operation.type === 'delete') {
          const current = await readAssistantArtifactFile(this.threadId, operationPath);
          planned.push({ operation, path: operationPath, revision: current.revision });
          continue;
        }
        const current = await readAssistantArtifactFile(this.threadId, operationPath);
        if (current.binary) throw new Error(`cannot patch binary artifact: ${operationPath}`);
        const content =
          operation.hunks.length > 0
            ? this.patchEngine.applyHunks(current.content, operation.hunks, operationPath)
            : current.content;
        const moveTo = operation.moveTo
          ? normalizeAssistantArtifactPath(operation.moveTo)
          : undefined;
        if (moveTo) {
          if (await statAssistantArtifactPath(this.threadId, moveTo)) {
            throw new Error(`move destination exists: ${moveTo}`);
          }
        }
        planned.push({
          operation,
          path: operationPath,
          ...(moveTo ? { moveTo } : {}),
          content,
          revision: current.revision,
        });
      }

      const changedPaths: string[] = [];
      for (const item of planned) {
        const operation = item.operation;
        if (operation.type === 'add') {
          await runAssistantArtifactAction(this.threadId, {
            action: 'write',
            path: item.path,
            content: item.content,
            mode: 'create',
          });
          changedPaths.push(item.path);
        } else if (operation.type === 'delete') {
          await runAssistantArtifactAction(this.threadId, {
            action: 'delete',
            path: item.path,
            baseRevision: item.revision,
          });
          changedPaths.push(item.path);
        } else {
          if (item.moveTo) {
            const separator = item.moveTo.lastIndexOf('/');
            if (separator > 0) {
              await runAssistantArtifactAction(this.threadId, {
                action: 'create_directory',
                path: item.moveTo.slice(0, separator),
                recursive: true,
              });
            }
          }
          await runAssistantArtifactAction(this.threadId, {
            action: 'write',
            path: item.path,
            content: item.content,
            baseRevision: item.revision,
            mode: 'overwrite',
          });
          changedPaths.push(item.path);
          if (item.moveTo) {
            await runAssistantArtifactAction(this.threadId, {
              action: 'move',
              from: item.path,
              to: item.moveTo,
              overwrite: false,
            });
            changedPaths.push(item.moveTo);
          }
        }
      }
      const uniqueChangedPaths = Array.from(new Set(changedPaths));
      return textResult(`applied patch\n${uniqueChangedPaths.join('\n')}`, {
        changedPaths: uniqueChangedPaths,
        operations: operations.map((operation) => operation.type),
      });
    }
    throw new Error(`artifacts target does not support ${call.tool}`);
  }
}
