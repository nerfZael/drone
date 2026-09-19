import { FilesystemService } from '../filesystem-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type FilesystemDependencyName =
  | 'FS_EDITOR_MAX_BYTES'
  | 'FS_LIST_TIMEOUT_MS'
  | 'FS_MEDIA_MAX_BYTES'
  | 'FS_QUICK_OPEN_MAX_RESULTS'
  | 'FS_TEXT_CHUNK_MAX_BYTES'
  | 'FS_THUMB_MAX_BYTES'
  | 'NON_REPO_HOME_CWD'
  | 'bufferLooksBinary'
  | 'buildFsSearchScript'
  | 'clampIntParam'
  | 'defaultDroneHomeCwd'
  | 'droneRuntime'
  | 'dvmCopyFromContainer'
  | 'dvmExec'
  | 'dvmPorts'
  | 'guessImageMimeType'
  | 'guessVideoMimeType'
  | 'handleFsActionRoute'
  | 'handleFsUploadRoute'
  | 'hostFsErrorStatus'
  | 'hostMimeType'
  | 'isLikelyImagePath'
  | 'isLikelyTextMimeType'
  | 'isLikelyVideoPath'
  | 'listHostFsDirectory'
  | 'looksLikeMissingContainerError'
  | 'normalizeFsPathForRuntime'
  | 'parseContainerFsListOutput'
  | 'parseFsSearchOutput'
  | 'readHostFileBytes'
  | 'resolveDroneOrRespond'
  | 'runHostCommand'
  | 'withLockedDroneContainer'
  | 'withReadonlyDroneContainer';

export type FilesystemRouteDependencies = LegacyRouteDependencyContract<FilesystemDependencyName>;

export function createFilesystemRouteHandler(
  deps: FilesystemRouteDependencies,
): LegacyRouteHandler {
  return new FilesystemService(deps).handle;
}
