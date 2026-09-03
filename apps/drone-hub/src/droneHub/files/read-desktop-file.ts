import type { DroneFsReadPayload } from '../types';
import { desktopFileContentReadUrl, desktopFileReadUrl } from './file-read-url';

type SuccessfulRead = Extract<DroneFsReadPayload, { ok: true }>;

export async function readDesktopFile(
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>,
  droneId: string,
  filePath: string,
): Promise<SuccessfulRead> {
  const initialUrl = desktopFileReadUrl(droneId, filePath);
  let response = await requestJson<SuccessfulRead>(initialUrl);
  if (
    initialUrl.includes('&metadata=1') &&
    response.kind === 'text' &&
    typeof (response as { content?: unknown }).content !== 'string'
  ) {
    response = await requestJson<SuccessfulRead>(desktopFileContentReadUrl(droneId, filePath));
  }
  if (
    response.kind === 'text' &&
    typeof (response as { content?: unknown }).content !== 'string'
  ) {
    throw new Error('text file response missing content');
  }
  return response;
}
