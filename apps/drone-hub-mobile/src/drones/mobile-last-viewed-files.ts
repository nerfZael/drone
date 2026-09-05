import type { MobileFileReference } from '../local-assistant/file-reference';
import { BoundedSwrCache } from './bounded-swr-cache';
import { mobileFileCacheKey, type MobileFileCacheContext } from './mobile-file-cache-key';

type WorkspaceContext = Omit<MobileFileCacheContext, 'path'>;

/** Session history: shared by a drone's chats, isolated per native artifact chat. */
export class MobileLastViewedFiles {
  private readonly files = new BoundedSwrCache<MobileFileReference>({
    maxEntries: 64,
    maxAgeMs: Infinity,
  });

  remember(context: WorkspaceContext, reference: MobileFileReference): void {
    this.files.set(mobileFileCacheKey({ ...context, path: '' }), reference);
  }

  recall(context: WorkspaceContext): MobileFileReference | undefined {
    return this.files.get(mobileFileCacheKey({ ...context, path: '' }));
  }
}
