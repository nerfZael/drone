import React from 'react';
import { toByteArray } from 'base64-js';
import { File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import type { DroneControlOperation } from '@drone/device-protocol';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import type { MobileFileReference } from '../local-assistant/file-reference';
import {
  mobileFileName,
  MOBILE_MEDIA_PREVIEW_MAX_BYTES,
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
}: {
  targetId: string;
  selectedDrone: MobileDroneSummary | null;
  chatName: string;
  phoneTarget: boolean;
  requestDroneControl: RequestDroneControl;
}) {
  const [request, setRequest] = React.useState<PreviewRequest | null>(null);
  const [preview, setPreview] = React.useState<MobileFilePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const previewFileRef = React.useRef<File | null>(null);
  const loadVersion = React.useRef(0);

  const discardCachedPreview = React.useCallback(() => {
    const file = previewFileRef.current;
    previewFileRef.current = null;
    if (!file) return;
    setTimeout(() => deleteCachedFile(file), 500);
  }, []);
  React.useEffect(() => () => discardCachedPreview(), [discardCachedPreview]);

  const load = React.useCallback(
    async (nextRequest: PreviewRequest) => {
      const version = ++loadVersion.current;
      setLoading(true);
      setError(null);
      setPreview(null);
      discardCachedPreview();
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
            ...(typeof content?.content === 'string' ? { content: content.content } : {}),
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
                  });
            firstResult = null;
            const resultPreview = result?.preview;
            const chunk = result?.mediaChunk;
            const bytes = toByteArray(String(chunk?.dataBase64 ?? ''));
            const nextOffset = offset + bytes.length;
            const expectedMtime = Number(metadata.mtimeMs);
            const resultMtime = Number(resultPreview?.mtimeMs);
            if (
              resultPreview?.kind !== metadata.kind ||
              Number(resultPreview?.size) !== totalBytes ||
              (Number.isFinite(expectedMtime) &&
                Number.isFinite(resultMtime) &&
                resultMtime !== expectedMtime) ||
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
            content: new TextDecoder().decode(bytes),
          });
          return;
        }
        if (!cacheFile) throw new Error('The media preview cache could not be created');
        previewFileRef.current = cacheFile;
        setPreview({
          path,
          name: mobileFileName(path),
          kind: metadata.kind,
          mime,
          size: totalBytes,
          mtimeMs: Number.isFinite(Number(metadata.mtimeMs)) ? Number(metadata.mtimeMs) : null,
          uri: cacheFile.uri,
        });
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
        if (version === loadVersion.current) setLoading(false);
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

  return {
    visible: Boolean(request),
    preview,
    requestedPath: request?.path ?? '',
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
