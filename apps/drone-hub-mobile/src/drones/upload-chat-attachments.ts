/** Limit simultaneous transfers and finish in-flight work before cleaning up a failed batch. */
export async function uploadChatAttachments<T>(
  attachments: readonly T[],
  upload: (attachment: T) => Promise<string>,
  abort: (attachmentIds: string[]) => Promise<void>,
): Promise<string[]> {
  const ids = new Array<string>(attachments.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && cursor < attachments.length) {
      const index = cursor++;
      try {
        ids[index] = await upload(attachments[index]!);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, attachments.length) }, worker));
  if (failed) {
    await abort(ids.filter(Boolean)).catch(() => undefined);
    throw failure;
  }
  return ids;
}
