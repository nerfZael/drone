import { createHttpWorkspaceSource } from './http-workspace-source';
import { createHttpWorkspaceDestination } from './http-workspace-destination';
import type { WorkspaceRequest, WorkspaceUploadSink } from './http-workspace-types';
export type { WorkspaceUploadTicket, WorkspaceUploadSink } from './http-workspace-types';

// The workspace engine's chunks are local bounded I/O buffers, never network messages.
export function createHttpWorkspaceAdapter(options: {
  request: WorkspaceRequest;
  read: boolean;
  write: boolean;
  fetchImpl?: typeof fetch;
  createSink(): Promise<WorkspaceUploadSink>;
}) {
  return {
    ...(options.read
      ? { source: createHttpWorkspaceSource(options.request, options.fetchImpl ?? fetch) }
      : {}),
    ...(options.write
      ? { destination: createHttpWorkspaceDestination(options.request, options.createSink) }
      : {}),
  };
}
