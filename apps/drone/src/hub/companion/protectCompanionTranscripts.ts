import path from 'node:path';
import fs from 'node:fs/promises';
import type { WorkspaceTarget } from '@blip/tools';

/** Keep the recording bundles read-only to Companion without changing access to its other files. */
export function protectCompanionTranscripts(target: WorkspaceTarget, root: string): WorkspaceTarget {
  const check = async (requested: unknown) => {
    if (typeof requested !== 'string') throw new Error('A workspace path is required.');
    const absolute = path.resolve(root, requested);
    const protectedRoot = path.join(root, 'transcripts');
    const overlaps = (file: string) => file === protectedRoot || file.startsWith(protectedRoot + path.sep) || protectedRoot.startsWith(file + path.sep);
    if (overlaps(absolute)) throw new Error('Recordings are read-only to Companion. Use the Recordings UI to change or delete them.');
    // A workspace alias must not allow an otherwise harmless-looking path to modify transcripts.
    let ancestor = absolute;
    while (ancestor !== path.dirname(ancestor)) {
      try {
        const resolved = await fs.realpath(ancestor);
        const realTarget = path.resolve(resolved, path.relative(ancestor, absolute));
        if (overlaps(realTarget)) throw new Error('Recordings are read-only to Companion.');
        break;
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
    }
  };
  const destination = target.transfer?.destination;
  return {
    descriptor: { ...target.descriptor, label: `${target.descriptor.label}; transcripts/ contains read-only meeting transcripts. Check status: only complete transcripts are final.` },
    transfer: target.transfer ? {
      source: target.transfer.source,
      destination: destination ? {
        createDirectory: async (file, signal) => { await check(file); return destination.createDirectory(file, signal); },
        prepareFile: async (input, signal) => { await check(input.path); return destination.prepareFile(input, signal); },
        writeChunk: async (input, signal) => { await check(input.path); return destination.writeChunk(input, signal); },
        commitFile: async (input, signal) => { await check(input.path); return destination.commitFile(input, signal); },
        abortFile: async (input, signal) => { await check(input.path); return destination.abortFile?.(input, signal); },
      } : undefined,
    } : undefined,
    execute: async call => {
      if (['write_file', 'delete_file', 'create_directory', 'delete_directory'].includes(call.tool)) await check(call.args.path);
      else if (call.tool === 'move_path') { await check(call.args.from); await check(call.args.to); }
      else if (call.tool === 'apply_patch') {
        const patch = String(call.args.patch ?? '');
        for (const match of patch.matchAll(/^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+)\r?$/gm)) await check(match[1].trim());
      }
      return target.execute(call);
    },
  };
}
