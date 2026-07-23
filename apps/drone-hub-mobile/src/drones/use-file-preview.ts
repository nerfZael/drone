import React from 'react';
import { AppState } from 'react-native';
import { toByteArray } from 'base64-js';
import { File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import type { DroneControlOperation } from '@drone/device-protocol';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import type { MobileFileReference } from '../local-assistant/file-reference';
import {
  mobileFileName,
  MOBILE_MEDIA_PREVIEW_MAX_BYTES,
  mobileWorkspaceRelativeFilePath,
  resolveMobileDroneFilePath,
  type MobileFilePreview,
} from './file-preview-model';
import type { MobileDroneSummary } from './drone-sidebar-model';

type PreviewRequest = {
  targetId: string;
  droneId: string;
  chatName: string;
  path: string;
  line: number | null;
};

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
) => Promise<any>;

function deleteCachedFile(file: File | null) {
  if (!file) return;
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best effort.
  }
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
  const [preview, setPreview] = React.useState<MobileFilePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const previewFileRef = React.useRef<File | null>(null);
  const previewRef = React.useRef<MobileFilePreview | null>(null);
  const loadVersion = React.useRef(0);
  previewRef.current = preview;

  const discardCachedPreview = React.useCallback(() => {
    const file = previewFileRef.current;
    previewFileRef.current = null;
    if (!file) return;
    setTimeout(() => deleteCachedFile(file), 500);
  }, []);
  React.useEffect(() => () => discardCachedPreview(), [discardCachedPreview]);

  const load = React.useCallback(
    async (nextRequest: PreviewRequest, options?: { background?: boolean }) => {
      const version = ++loadVersion.current;
      const background = options?.background === true && previewRef.current != null;
      if (!background) setLoading(true);
      setError(null);
      if (!background) {
        setPreview(null);
        discardCachedPreview();
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
          const content = await readMeshJsonContent(async (contentOffset) => {
            if (contentOffset === 0 && firstAvailable) {
              firstAvailable = false;
              return firstResult.contentChunk;
            }
            const next = await requestDroneControl(nextRequest.targetId, 'file.preview', {
              droneId: nextRequest.droneId,
              chatName: nextRequest.chatName,
              path: nextRequest.path,
              contentOffset,
            });
            return next?.contentChunk ?? {};
          });
          if (version !== loadVersion.current) return;
          const path = String(content?.path ?? nextRequest.path).trim() || nextRequest.path;
          setPreview({
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
          });
          if (background) discardCachedPreview();
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
          while (offset < totalBytes) {
            const result =
              offset === 0
                ? firstResult
                : await requestDroneControl(nextRequest.targetId, 'file.preview', {
                    droneId: nextRequest.droneId,
                    chatName: nextRequest.chatName,
                    path: nextRequest.path,
                    contentOffset: offset,
                    expectedRevision: metadata.revision,
                  });
            firstResult = null;
            const resultPreview = result?.preview;
            const chunk = result?.mediaChunk;
            const bytes = toByteArray(String(chunk?.dataBase64 ?? ''));
            const nextOffset = offset + bytes.length;
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
              Number(chunk?.offset) !== offset ||
              Number(chunk?.bytes) !== bytes.length ||
              Number(chunk?.totalBytes) !== totalBytes ||
              bytes.length === 0 ||
              chunk?.done !== (nextOffset === totalBytes)
            ) {
              throw new Error('The selected device returned an invalid media chunk');
            }
            appendBytes(bytes);
            offset = nextOffset;
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
          setPreview({
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
          });
          if (background) discardCachedPreview();
          return;
        }
        if (!cacheFile) throw new Error('The media preview cache could not be created');
        const previousCacheFile = previewFileRef.current;
        previewFileRef.current = cacheFile;
        setPreview({
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
        });
        if (previousCacheFile && previousCacheFile !== cacheFile) {
          setTimeout(() => deleteCachedFile(previousCacheFile), 500);
        }
      } catch (nextError: any) {
        if (version === loadVersion.current) {
          const message = nextError?.message ?? String(nextError);
          setError(
            /not granted|not permitted|access|denied/i.test(message)
              ? `${message}. Enable “drone-control: file.preview” for this phone in Devices if needed.`
              : message,
          );
        }
      } finally {
        if (version === loadVersion.current && !background) setLoading(false);
      }
    },
    [discardCachedPreview, requestDroneControl],
  );

  const open = React.useCallback(
    (reference: MobileFileReference) => {
      if (!selectedDrone) return;
      const nextRequest = {
        targetId,
        droneId: selectedDrone.id,
        chatName,
        path: phoneTarget
          ? reference.path
          : resolveMobileDroneFilePath(selectedDrone, reference.path),
        line: reference.line,
      };
      setRequest(nextRequest);
      void load(nextRequest);
    },
    [chatName, load, phoneTarget, selectedDrone, targetId],
  );

  const close = React.useCallback(() => {
    loadVersion.current += 1;
    setRequest(null);
    setPreview(null);
    setError(null);
    setLoading(false);
    discardCachedPreview();
  }, [discardCachedPreview]);

  React.useEffect(() => {
    if (!request || !preview) return;
    let active = true;
    let checking = false;
    let checkCount = 0;
    const checkForChange = async (forceRevision = false) => {
      if (!active || checking || AppState.currentState !== 'active') return;
      checking = true;
      try {
        checkCount += 1;
        const includeRevision =
          !phoneTarget || forceRevision || checkCount % 15 === 0;
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
    const interval = setInterval(
      () => void checkForChange(),
      phoneTarget ? 2_000 : 30_000,
    );
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForChange(true);
    });
    let unsubscribeEvent: (() => void) | undefined;
    let watchSubscription: Promise<any> | null = null;
    const watchId = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!phoneTarget && subscribeFileChanges) {
      unsubscribeEvent = subscribeFileChanges((payload) => {
        const eventPath = String(payload?.path ?? '');
        const eventRevision =
          typeof payload?.revision === 'string' && payload.revision.trim()
            ? payload.revision.trim()
            : null;
        if (
          String(payload?.droneId ?? '') !== request.droneId ||
          (eventPath !== request.path && eventPath !== previewRef.current?.path)
        ) {
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
    requestDroneControl,
    subscribeFileChanges,
  ]);

  return {
    visible: Boolean(request),
    preview,
    displayPath: selectedDrone
      ? mobileWorkspaceRelativeFilePath(selectedDrone, preview?.path ?? request?.path ?? '')
      : (preview?.path ?? request?.path ?? ''),
    line: request?.line ?? null,
    loading,
    error,
    open,
    close,
    retry: () => {
      if (request) void load(request);
    },
  };
}
