import { spawn } from 'node:child_process';

import { encodeRemotePath, hexEncodeUtf8, shellQuoteIfNeeded } from './hub-format';
import { sendJson as json } from './hub-http';
import type { EditorRouteDependencies } from './routes/editor-routes';
import type { LegacyRouteHandler } from './routes/legacy-route';

export class EditorRouteService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: EditorRouteDependencies) {
    this.handle = createEditorRouteHandler(deps);
  }
}

function createEditorRouteHandler(deps: EditorRouteDependencies): LegacyRouteHandler {
  const { dockerContainerId, droneRuntime, normalizeDroneUiCwdForRuntime, resolveDroneOrRespond } =
    deps;

  return async ({ res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/open-editor?editor=code|cursor&cwd=/path
      // Opens a local editor attached to the docker container (VS Code Dev Containers style).
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'open-editor'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const editorRaw = String(u.searchParams.get('editor') ?? 'code')
          .trim()
          .toLowerCase();
        const editor =
          editorRaw === 'code' || editorRaw === 'cursor' ? (editorRaw as 'code' | 'cursor') : null;
        if (!editor) {
          json(res, 400, {
            ok: false,
            error: `invalid editor: ${editorRaw} (expected code|cursor)`,
          });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const cwd = normalizeDroneUiCwdForRuntime(drone, u.searchParams.get('cwd') ?? null);
        if (runtime === 'host') {
          const uri = `file://${encodeRemotePath(cwd)}`;
          const manualCommand = `${editor} ${shellQuoteIfNeeded(cwd)}`;
          const launched = await new Promise<
            { ok: true; launcher: string } | { ok: false; error: string }
          >((resolve) => {
            const child = spawn(editor, [cwd], {
              detached: true,
              stdio: 'ignore',
              env: process.env,
            });
            child.once('error', (err: any) =>
              resolve({ ok: false, error: err?.message ?? String(err) }),
            );
            child.once('spawn', () => {
              try {
                child.unref();
              } catch {
                // ignore
              }
              resolve({ ok: true, launcher: `${editor} ${cwd}` });
            });
          });
          if (!launched.ok) {
            json(res, 500, {
              ok: false,
              error: launched.error,
              uri,
              manualCommand,
              note: 'Install the editor and run the command manually.',
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            editor,
            cwd,
            uri,
            manualCommand,
            launcher: launched.launcher,
          });
          return;
        }

        const containerNameRaw = String(
          (drone as any)?.containerName ?? (drone as any)?.name ?? `drone-${droneId}`,
        ).trim();
        const id = await dockerContainerId(containerNameRaw);
        // Dev Containers "attached-container" URIs expect a hex-encoded JSON payload as the authority suffix.
        // If we pass a raw docker ID, the extension will try to decode it and we end up with a corrupted
        // container identifier (seen as "��..." in logs).
        const containerName = `/${containerNameRaw}`;
        const authorityJson = JSON.stringify({
          settingType: 'container',
          containerId: id,
          containerName,
        });
        const authority = hexEncodeUtf8(authorityJson);
        const uri = `vscode-remote://attached-container+${authority}${encodeRemotePath(cwd)}`;
        const manualCommand = `${editor} --folder-uri ${shellQuoteIfNeeded(uri)}`;

        const launched = await new Promise<
          { ok: true; launcher: string } | { ok: false; error: string }
        >((resolve) => {
          const child = spawn(editor, ['--folder-uri', uri], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
          child.once('error', (err: any) =>
            resolve({ ok: false, error: err?.message ?? String(err) }),
          );
          child.once('spawn', () => {
            try {
              child.unref();
            } catch {
              // ignore
            }
            resolve({ ok: true, launcher: `${editor} --folder-uri ${uri}` });
          });
        });

        if (!launched.ok) {
          json(res, 500, {
            ok: false,
            error: launched.error,
            uri,
            manualCommand,
            note: 'Install the editor and run the command manually.',
          });
          return;
        }

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          editor,
          cwd,
          uri,
          manualCommand,
          launcher: launched.launcher,
        });
        return;
      }

      return false;
    })();
    return handled !== false;
  };
}
