export type WorkspaceRequest = (
  operation: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<any>;

export type WorkspaceUploadTicket = { url: string; token: string; size: number };

/** Platform-specific disk staging; retry and commit policy belongs to the destination. */
export type WorkspaceUploadSink = {
  write(bytes: Uint8Array): Promise<void>;
  finish(
    ticket: WorkspaceUploadTicket,
    offset: number,
    signal?: AbortSignal,
    skipBytes?: number,
  ): Promise<number>;
  close(): Promise<void>;
};
