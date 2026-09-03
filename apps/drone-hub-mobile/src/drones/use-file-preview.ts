import React from 'react';
import { AppState } from 'react-native';
import { toByteArray } from 'base64-js';
import { File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import type { DroneControlOperation } from '@drone/device-protocol';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import type { MobileFileReference } from '../local-assistant/file-reference';
import {
  MOBILE_FILE_EDIT_MAX_BYTES,
  MOBILE_FILE_WRITE_PAYLOAD_MAX_BYTES,
  mobileFileName,
  mobileDroneWorkspaceRoot,
  mobileUtf8ByteLength,
  MOBILE_MEDIA_PREVIEW_MAX_BYTES,
  MOBILE_SVG_PREVIEW_MAX_BYTES,
  mobileWorkspaceRelativeFilePath,
  resolveMobileDroneFilePath,
  type MobileFilePreview,
} from './file-preview-model';
import type { MobileDroneSummary } from './drone-sidebar-model';
import { BoundedSwrCache } from './bounded-swr-cache';
import { mobileFileCacheKey } from './mobile-file-cache-key';
import { mobilePreviewErrorMode } from './mobile-preview-error-state';
import { readPipelinedMediaChunks } from './read-pipelined-media-chunks';

type PreviewRequest = {
  targetId: string;
  droneId: string;
  chatName: string;
  phoneTarget: boolean;
  path: string;
  line: number | null;
};

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
) => Promise<any>;

type CachedFilePreview = {
  file: File | null;
  preview: MobileFilePreview;
};

function deleteCachedFile(file: File | null) {
  if (!file) return;
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best effort.
  }
}

function sameFilePreview(left: MobileFilePreview, right: MobileFilePreview): boolean {
  return (
    left.path === right.path &&
    left.kind === right.kind &&
    left.mime === right.mime &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.revision === right.revision &&
    left.content === right.content
  );
}

export function useFilePreview({
  targetId,
  selectedDrone,
  chatName,
  phoneTarget,
  requestDroneControl,
  subscribeFileChanges,
}: {
  targetId: string;
  selectedDrone: MobileDroneSummary | null;
  chatName: string;
  phoneTarget: boolean;
  requestDroneControl: RequestDroneControl;
  subscribeFileChanges?: (listener: (payload: Record<string, any>) => void) => () => void;
}) {
  const [request, setRequest] = React.useState<PreviewRequest | null>(null);
  const [workspaceContext, setWorkspaceContext] = React.useState<Omit<
    PreviewRequest,
    'path' | 'line'
  > | null>(null);
  const [preview, setPreview] = React.useState<MobileFilePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const previewFileRef = React.useRef<File | null>(null);
  const previewRef = React.useRef<MobileFilePreview | null>(null);
  const previewCacheRef = React.useRef<BoundedSwrCache<CachedFilePreview> | null>(null);
  if (!previewCacheRef.current) {
    previewCacheRef.current = new BoundedSwrCache({
      maxEntries: 6,
      maxAgeMs: 2 * 60_000,
      onEvict: ({ file }) => {
        if (file) setTimeout(() => deleteCachedFile(file), 500);
      },
    });
  }
  const loadVersion = React.useRef(0);
  const saveVersion = React.useRef(0);
  previewRef.current = preview;

  const clearActivePreview = React.useCallback(() => {
    previewFileRef.current = null;
  }, []);
  React.useEffect(() => () => previewCacheRef.current?.clear(), []);

  const commitPreview = React.useCallback(
    (nextRequest: PreviewRequest, next: CachedFilePreview) => {
      const key = mobileFileCacheKey(nextRequest);
      const current = previewCacheRef.current!.get(key);
      const retained =
        current && sameFilePreview(current.preview, next.preview)
          ? current
          : previewCacheRef.current!.set(key, next);
      if (retained === current && next.file && next.file !== current.file) {
        setTimeout(() => deleteCachedFile(next.file), 500);
      }
      previewFileRef.current = retained.file;
      previewRef.current = retained.preview;
      setPreview((value) => (value === retained.preview ? value : retained.preview));
    },
    [],
  );

  const load = React.useCallback(
    async (nextRequest: PreviewRequest, options?: { background?: boolean }) => {
      const version = ++loadVersion.current;
      const background = options?.background === true && previewRef.current != null;
      if (!background) setLoading(true);
      if (!background) setError(null);
      setRefreshError(null);
      if (!background) {
        setPreview(null);
        clearActivePreview();
      }
      try {
        let firstResult: any = await requestDroneControl(nextRequest.targetId, 'file.preview', {
          droneId: nextRequest.droneId,
          chatName: nextRequest.chatName,
          path: nextRequest.path,
          contentOffset: 0,
        });
        if (firstResult?.contentChunk) {
          let firstAvailable = true;
          const content = await readMeshJsonContent(
            async (contentOffset, snapshotToken) => {
              if (contentOffset === 0 && firstAvailable) {
                firstAvailable = false;
                return firstResult.contentChunk;
              }
              const next = await requestDroneControl(nextRequest.targetId, 'file.preview', {
                droneId: nextRequest.droneId,
                chatName: nextRequest.chatName,
                path: nextRequest.path,
                contentOffset,
                ...(snapshotToken ? { snapshotToken } : {}),
              });
              return next?.contentChunk ?? {};
            },
            {
              isCancelled: () => version !== loadVersion.current,
            },
          );
          if (version !== loadVersion.current) return;
          const path = String(content?.path ?? nextRequest.path).trim() || nextRequest.path;
          commitPreview(nextRequest, {
            file: null,
            preview: {
              path,
              name: mobileFileName(path),
              kind:
                content?.kind === 'binary' || content?.kind === 'image' || content?.kind === 'video'
                  ? content.kind
                  : 'text',
              mime: String(content?.mime ?? 'text/plain'),
              size: Math.max(0, Number(content?.size) || 0),
              mtimeMs: Number.isFinite(Number(content?.mtimeMs)) ? Number(content.mtimeMs) : null,
              revision:
                typeof content?.revision === 'string' && content.revision.trim()
                  ? content.revision.trim()
                  : null,
              ...(typeof content?.content === 'string' ? { content: content.content } : {}),
            },
          });
          return;
        }

        const metadata = firstResult?.preview;
        if (!metadata || (metadata.kind !== 'image' && metadata.kind !== 'video')) {
          throw new Error('The selected device returned an invalid file preview');
        }
        const totalBytes = Number(metadata.size);
        if (
          !Number.isSafeInteger(totalBytes) ||
          totalBytes <= 0 ||
          totalBytes > MOBILE_MEDIA_PREVIEW_MAX_BYTES
        ) {
          throw new Error('The media preview size is invalid or too large for this phone');
        }
        const path = String(metadata.path ?? nextRequest.path).trim() || nextRequest.path;
        const mime = String(metadata.mime ?? '');
        const svg = metadata.kind === 'image' && mime === 'image/svg+xml';
        if (svg && totalBytes > MOBILE_SVG_PREVIEW_MAX_BYTES) {
          throw new Error('This SVG is too large to render safely on this phone');
        }
        const chunks: Uint8Array[] = [];
        const extension = mobileFileName(path)
          .split('.')
          .at(-1)
          ?.replace(/[^a-z0-9]/gi, '')
          .slice(0, 12);
        const cacheFile = svg
          ? null
          : new File(
              Paths.cache,
              `drone-preview-${Date.now()}-${Math.random().toString(36).slice(2)}${extension ? `.${extension}` : ''}`,
            );
        let cacheHandle: FileHandle | null = null;
        let offset = 0;
        try {
          if (cacheFile) {
            cacheFile.create({ overwrite: true });
            cacheHandle = cacheFile.open(FileMode.WriteOnly);
          }
          const appendBytes = (bytes: Uint8Array) => {
            if (svg) chunks.push(bytes);
            else cacheHandle?.writeBytes(bytes);
          };
          const inlineBytes = firstResult?.mediaDataBase64
            ? toByteArray(String(firstResult.mediaDataBase64))
            : null;
          if (inlineBytes) {
            if (inlineBytes.length !== totalBytes) {
              throw new Error('The phone returned an invalid media preview');
            }
            appendBytes(inlineBytes);
            offset = inlineBytes.length;
            firstResult = null;
          }
          if (offset < totalBytes) {
            await readPipelinedMediaChunks({
              firstResult,
              totalBytes,
              requestResult: async (contentOffset, snapshotToken) =>
                await requestDroneControl(nextRequest.targetId, 'file.preview', {
                  droneId: nextRequest.droneId,
                  chatName: nextRequest.chatName,
                  path: nextRequest.path,
                  contentOffset,
                  expectedRevision: metadata.revision,
                  ...(snapshotToken ? { snapshotToken, mediaSnapshot: true } : {}),
                }),
              validateResult: (result, contentOffset) => {
                const resultPreview = result?.preview;
                const chunk = result?.mediaChunk;
                const bytes = toByteArray(String(chunk?.dataBase64 ?? ''));
                const nextOffset = contentOffset + bytes.length;
                const expectedMtime = Number(metadata.mtimeMs);
                const resultMtime = Number(resultPreview?.mtimeMs);
                const expectedRevision =
                  typeof metadata.revision === 'string' ? metadata.revision : null;
                const resultRevision =
                  typeof resultPreview?.revision === 'string' ? resultPreview.revision : null;
                if (
                  resultPreview?.kind !== metadata.kind ||
                  Number(resultPreview?.size) !== totalBytes ||
                  (Number.isFinite(expectedMtime) &&
                    Number.isFinite(resultMtime) &&
                    resultMtime !== expectedMtime) ||
                  (expectedRevision && resultRevision !== expectedRevision) ||
                  chunk?.encoding !== 'base64-binary' ||
                  Number(chunk?.offset) !== contentOffset ||
                  Number(chunk?.bytes) !== bytes.length ||
                  Number(chunk?.totalBytes) !== totalBytes ||
                  bytes.length === 0 ||
                  chunk?.done !== (nextOffset === totalBytes)
                ) {
                  throw new Error('The selected device returned an invalid media chunk');
                }
                const snapshotToken =
                  typeof chunk?.snapshotToken === 'string' && chunk.snapshotToken.trim()
                    ? chunk.snapshotToken.trim()
                    : undefined;
                return { bytes, snapshotToken };
              },
              appendBytes,
              isCancelled: () => version !== loadVersion.current,
            });
            offset = totalBytes;
            firstResult = null;
          }
        } catch (mediaError) {
          cacheHandle?.close();
          cacheHandle = null;
          deleteCachedFile(cacheFile);
          throw mediaError;
        } finally {
          cacheHandle?.close();
        }
        if (offset !== totalBytes) throw new Error('The media preview did not finish loading');
        if (version !== loadVersion.current) {
          deleteCachedFile(cacheFile);
          return;
        }
        if (svg) {
          const bytes = new Uint8Array(totalBytes);
          let position = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, position);
            position += chunk.length;
          }
          commitPreview(nextRequest, {
            file: null,
            preview: {
              path,
              name: mobileFileName(path),
              kind: 'image',
              mime,
              size: totalBytes,
              mtimeMs: Number.isFinite(Number(metadata.mtimeMs)) ? Number(metadata.mtimeMs) : null,
              revision:
                typeof metadata.revision === 'string' && metadata.revision.trim()
                  ? metadata.revision.trim()
                  : null,
              content: new TextDecoder().decode(bytes),
            },
          });
          return;
        }
        if (!cacheFile) throw new Error('The media preview cache could not be created');
        commitPreview(nextRequest, {
          file: cacheFile,
          preview: {
            path,
            name: mobileFileName(path),
            kind: metadata.kind,
            mime,
            size: totalBytes,
            mtimeMs: Number.isFinite(Number(metadata.mtimeMs)) ? Number(metadata.mtimeMs) : null,
            revision:
              typeof metadata.revision === 'string' && metadata.revision.trim()
                ? metadata.revision.trim()
                : null,
            uri: cacheFile.uri,
          },
        });
      } catch (nextError: any) {
        if (version === loadVersion.current) {
          const message = nextError?.message ?? String(nextError);
          const displayMessage = /not granted|not permitted|access|denied/i.test(message)
            ? `${message}. Enable “drone-control: file.preview” for this phone in Devices if needed.`
            : message;
          if (
            mobilePreviewErrorMode({
              background,
              previewKind: previewRef.current?.kind ?? null,
            }) === 'refresh'
          ) {
            setRefreshError(displayMessage);
          } else {
            setError(displayMessage);
          }
        }
      } finally {
        if (version === loadVersion.current && !background) setLoading(false);
      }
    },
    [clearActivePreview, commitPreview, requestDroneControl],
  );

  const open = React.useCallback(
    (reference: MobileFileReference) => {
      if (!selectedDrone) return;
      const nextRequest = {
        targetId,
        droneId: selectedDrone.id,
        chatName,
        phoneTarget,
        path: phoneTarget
          ? reference.path
          : resolveMobileDroneFilePath(selectedDrone, reference.path),
        line: reference.line,
      };
      setWorkspaceContext({
        targetId: nextRequest.targetId,
        droneId: nextRequest.droneId,
        chatName: nextRequest.chatName,
        phoneTarget: nextRequest.phoneTarget,
      });
      saveVersion.current += 1;
      setRequest(nextRequest);
      setSaving(false);
      setSaveError(null);
      const cached = previewCacheRef.current!.get(mobileFileCacheKey(nextRequest));
      if (cached) {
        previewFileRef.current = cached.file;
        previewRef.current = cached.preview;
        setPreview(cached.preview);
        setLoading(false);
        setError(null);
        setRefreshError(null);
        void load(nextRequest, { background: true });
      } else {
        void load(nextRequest);
      }
    },
    [chatName, load, phoneTarget, selectedDrone, targetId],
  );

  const openExplorer = React.useCallback(() => {
    if (!selectedDrone) return;
    loadVersion.current += 1;
    saveVersion.current += 1;
    setWorkspaceContext({ targetId, droneId: selectedDrone.id, chatName, phoneTarget });
    setRequest(null);
    setPreview(null);
    setError(null);
    setRefreshError(null);
    setSaveError(null);
    setLoading(false);
    setSaving(false);
    clearActivePreview();
  }, [chatName, clearActivePreview, phoneTarget, selectedDrone, targetId]);

  const close = React.useCallback(() => {
    loadVersion.current += 1;
    saveVersion.current += 1;
    setWorkspaceContext(null);
    setRequest(null);
    setPreview(null);
    setError(null);
    setRefreshError(null);
    setLoading(false);
    setSaving(false);
    setSaveError(null);
    clearActivePreview();
  }, [clearActivePreview]);

  const requestIsCurrent = Boolean(
    request &&
    selectedDrone &&
    request.targetId === targetId &&
    request.droneId === selectedDrone.id &&
    request.chatName === chatName &&
    request.phoneTarget === phoneTarget,
  );
  const workspaceIsCurrent = Boolean(
    workspaceContext &&
    selectedDrone &&
    workspaceContext.targetId === targetId &&
    workspaceContext.droneId === selectedDrone.id &&
    workspaceContext.chatName === chatName &&
    workspaceContext.phoneTarget === phoneTarget,
  );
  React.useEffect(() => {
    if (workspaceContext && !workspaceIsCurrent) close();
  }, [close, workspaceContext, workspaceIsCurrent]);

  React.useEffect(() => {
    if (!request || !preview || !requestIsCurrent) return;
    let active = true;
    let checking = false;
    let checkCount = 0;
    const checkForChange = async (forceRevision = false) => {
      if (!active || checking || AppState.currentState !== 'active') return;
      checking = true;
      try {
        checkCount += 1;
        const includeRevision = !phoneTarget || forceRevision || checkCount % 15 === 0;
        const result = await requestDroneControl(request.targetId, 'file.preview', {
          droneId: request.droneId,
          chatName: request.chatName,
          path: request.path,
          metadataOnly: true,
          includeRevision,
        });
        if (!active) return;
        const nextRevision =
          typeof result?.preview?.revision === 'string' && result.preview.revision.trim()
            ? result.preview.revision.trim()
            : null;
        const currentRevision = previewRef.current?.revision ?? null;
        const nextSize = Number(result?.preview?.size);
        const nextMtimeMs = Number(result?.preview?.mtimeMs);
        const currentSize = Number(previewRef.current?.size);
        const currentMtimeMs = Number(previewRef.current?.mtimeMs);
        const fingerprintChanged =
          (Number.isFinite(nextSize) && nextSize !== currentSize) ||
          (Number.isFinite(nextMtimeMs) && nextMtimeMs !== currentMtimeMs);
        if (
          (nextRevision && nextRevision !== currentRevision) ||
          (!nextRevision && fingerprintChanged)
        ) {
          await load(request, { background: true });
        }
      } catch {
        // The visible preview stays usable while reconnect/fallback checks retry.
      } finally {
        checking = false;
      }
    };
    const interval = setInterval(() => void checkForChange(), phoneTarget ? 2_000 : 30_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForChange(true);
    });
    let unsubscribeEvent: (() => void) | undefined;
    let watchSubscription: Promise<any> | null = null;
    const watchId = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!phoneTarget && subscribeFileChanges) {
      unsubscribeEvent = subscribeFileChanges((payload) => {
        const eventPath = String(payload?.path ?? '');
        const eventDroneId = String(payload?.droneId ?? '');
        const eventRevision =
          typeof payload?.revision === 'string' && payload.revision.trim()
            ? payload.revision.trim()
            : null;
        if (eventDroneId !== request.droneId) return;
        if (eventPath !== request.path && eventPath !== previewRef.current?.path) {
          if (eventPath) {
            previewCacheRef.current!.delete(mobileFileCacheKey({ ...request, path: eventPath }));
          }
          return;
        }
        if (eventRevision && eventRevision === previewRef.current?.revision) return;
        void load(request, { background: true });
      });
      watchSubscription = requestDroneControl(request.targetId, 'file.preview', {
        droneId: request.droneId,
        chatName: request.chatName,
        path: request.path,
        watch: 'subscribe',
        watchId,
      });
      void watchSubscription.catch(() => undefined);
    }
    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
      unsubscribeEvent?.();
      if (!phoneTarget && subscribeFileChanges) {
        const unsubscribe = () =>
          requestDroneControl(request.targetId, 'file.preview', {
            droneId: request.droneId,
            chatName: request.chatName,
            path: request.path,
            watch: 'unsubscribe',
            watchId,
          }).catch(() => undefined);
        void (watchSubscription ?? Promise.resolve()).catch(() => undefined).then(unsubscribe);
      }
    };
  }, [
    load,
    phoneTarget,
    preview?.path,
    request,
    requestIsCurrent,
    requestDroneControl,
    subscribeFileChanges,
  ]);

  return {
    visible: workspaceIsCurrent,
    preview: requestIsCurrent ? preview : null,
    displayPath:
      requestIsCurrent && selectedDrone
        ? mobileWorkspaceRelativeFilePath(selectedDrone, preview?.path ?? request?.path ?? '')
        : '',
    line: requestIsCurrent ? (request?.line ?? null) : null,
    loading: requestIsCurrent && loading,
    error: requestIsCurrent ? error : null,
    refreshError: requestIsCurrent ? refreshError : null,
    saving: requestIsCurrent && saving,
    saveError: requestIsCurrent ? saveError : null,
    rootPath: selectedDrone && !phoneTarget ? mobileDroneWorkspaceRoot(selectedDrone) : '',
    selectedPath: requestIsCurrent ? (preview?.path ?? request?.path ?? '') : '',
    open,
    openExplorer,
    close,
    retry: () => {
      if (request && requestIsCurrent) {
        void load(request, { background: previewRef.current != null });
      }
    },
    invalidatePaths: (paths: readonly string[]) => {
      if (!workspaceContext) return;
      const normalizedPaths = new Set(
        paths.map((path) => String(path ?? '').trim()).filter(Boolean),
      );
      if (
        requestIsCurrent &&
        request &&
        (normalizedPaths.has(request.path) ||
          (previewRef.current?.path ? normalizedPaths.has(previewRef.current.path) : false))
      ) {
        loadVersion.current += 1;
      }
      for (const path of normalizedPaths) {
        previewCacheRef.current!.delete(mobileFileCacheKey({ ...workspaceContext, path }));
      }
    },
    save: async (content: string, expectedRevision?: string | null) => {
      if (!request || !requestIsCurrent || preview?.kind !== 'text' || saving) return false;
      const contentBytes = mobileUtf8ByteLength(content);
      if (contentBytes > MOBILE_FILE_EDIT_MAX_BYTES) {
        setSaveError(
          `This edit is too large to save on mobile (${contentBytes} bytes, max ${MOBILE_FILE_EDIT_MAX_BYTES}).`,
        );
        return false;
      }
      const writePayload = {
        droneId: request.droneId,
        chatName: request.chatName,
        path: preview.path,
        content,
        expectedRevision: expectedRevision ?? preview.revision,
      };
      if (
        !request.phoneTarget &&
        mobileUtf8ByteLength(JSON.stringify(writePayload)) > MOBILE_FILE_WRITE_PAYLOAD_MAX_BYTES
      ) {
        setSaveError('This edit contains too much encoded data to send safely from mobile.');
        return false;
      }
      const version = ++saveVersion.current;
      const savedPath = preview.path;
      setSaving(true);
      setSaveError(null);
      try {
        const result = await requestDroneControl(request.targetId, 'file.write', writePayload);
        if (saveVersion.current !== version) return false;
        setPreview((current) => {
          if (current?.path !== savedPath) return current;
          const next = {
            ...current,
            content,
            size: Math.max(0, Number(result?.size) || contentBytes),
            mtimeMs: Number.isFinite(Number(result?.mtimeMs))
              ? Number(result.mtimeMs)
              : current.mtimeMs,
            revision:
              typeof result?.revision === 'string' && result.revision.trim()
                ? result.revision.trim()
                : current.revision,
          };
          const retained = previewCacheRef.current!.set(mobileFileCacheKey(request), {
            file: previewFileRef.current,
            preview: next,
          });
          previewRef.current = retained.preview;
          return retained.preview;
        });
        return true;
      } catch (nextError: any) {
        if (saveVersion.current !== version) return false;
        const message = String(nextError?.message ?? nextError ?? 'Unable to save file.');
        setSaveError(
          /not granted|not permitted|access|denied/i.test(message)
            ? `${message}. Enable “drone-control: file.write” for this phone in Devices.`
            : message,
        );
        return false;
      } finally {
        if (saveVersion.current === version) setSaving(false);
      }
    },
  };
}
