import crypto from 'node:crypto';
import os from 'node:os';

import { bashQuote, shellQuoteIfNeeded } from './hub-format';
import { readJsonBody, sendJson as json } from './hub-http';
import {
  createHubShellSessionName,
  hubChatSessionName,
  hubShellSessionName,
  isHubShellSessionName,
  isHubWebTerminalSessionName,
  shouldAwaitTerminalSkillSync,
  type HubWebTerminalMode,
} from './terminal-open';
import type { TerminalRouteDependencies } from './routes/terminal-routes';
import type { LegacyRouteHandler } from './routes/legacy-route';

export class TerminalRouteService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: TerminalRouteDependencies) {
    this.handle = createTerminalRouteHandler(deps);
  }
}

function createTerminalRouteHandler(deps: TerminalRouteDependencies): LegacyRouteHandler {
  const {
    HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
    HUB_WEB_TERMINAL_MAX_BYTES,
    HUB_WEB_TERMINAL_MAX_TAIL_LINES,
    buildContainerManagedEnvLines,
    buildDockerExecShellCommand,
    buildDockerExecTmuxAttachCommand,
    buildEnvExportLines,
    clampIntParam,
    defaultDaemonReadyTimeoutMs,
    droneRuntime,
    droneTerminalInput,
    droneTerminalOutput,
    dvmExec,
    dvmSessionRead,
    dvmSessionStart,
    dvmSessionType,
    ensureChatEntry,
    ensureHubChatSessionRunning,
    ensureHubSessionRunning,
    isSafeTmuxSessionName,
    isStaleDockerExecErrorMessage,
    loadRegistry,
    normalizeChatName,
    normalizeDroneIdentity,
    normalizeDroneUiCwdForRuntime,
    parseOptionalNonNegativeInt,
    procStart,
    procStop,
    resolveChatTmuxCommand,
    resolveContainerManagedEnvVars,
    resolveDroneDaemonClientForEntry,
    resolveDroneEnvironmentConfig,
    resolveDroneOrRespond,
    resolveHostTerminalShellCommand,
    resolveHubAgentCommand,
    resolveHubTerminalShellCommand,
    spawnTerminalWithBash,
    syncMcpServersForDrone,
    syncRepoAgentsInstructionsForDrone,
    syncSkillLibraryForDrone,
    upgradeDroneDaemonInContainer,
    waitForDroneDaemonReady,
    withLockedDroneContainer,
  } = deps;

  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/terminal/open?mode=shell|agent&chat=<chatName>&cwd=/path&session=<name>&create=1
      // Opens (or reuses) a tmux-backed terminal session for in-app web terminal use.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[4] === 'open'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const runtime = droneRuntime(d);
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;

        const modeRaw = String(u.searchParams.get('mode') ?? 'shell')
          .trim()
          .toLowerCase();
        const mode: HubWebTerminalMode = modeRaw === 'agent' ? 'agent' : 'shell';
        const chatName = normalizeChatName(u.searchParams.get('chat') ?? 'default');
        const requestedSessionName = String(u.searchParams.get('session') ?? '').trim();
        const createNewShell = u.searchParams.get('create') === '1';
        const cwd = normalizeDroneUiCwdForRuntime(d, u.searchParams.get('cwd') ?? null);
        const regAny: any = await loadRegistry();
        const managedEnv = resolveDroneEnvironmentConfig(regAny, d).resolvedVars;
        const runtimeEnv = resolveContainerManagedEnvVars(d, managedEnv);
        const managedEnvLines = buildEnvExportLines(managedEnv);

        let shellSessionName = '';
        if (mode === 'agent') {
          if (createNewShell) {
            json(res, 400, {
              ok: false,
              error: 'agent terminal sessions cannot be created with create=1',
              id: droneId,
              name: droneName,
            });
            return;
          }
          if (requestedSessionName && requestedSessionName !== hubChatSessionName(chatName)) {
            json(res, 400, {
              ok: false,
              error: 'agent terminal session does not match the requested chat',
              id: droneId,
              name: droneName,
            });
            return;
          }
        } else {
          if (createNewShell && requestedSessionName) {
            json(res, 400, {
              ok: false,
              error: 'shell terminal open accepts either create=1 or session=<name>, not both',
              id: droneId,
              name: droneName,
            });
            return;
          }
          if (requestedSessionName) {
            if (
              !isSafeTmuxSessionName(requestedSessionName) ||
              !isHubShellSessionName(requestedSessionName)
            ) {
              json(res, 400, {
                ok: false,
                error: 'invalid shell terminal session name',
                id: droneId,
                name: droneName,
              });
              return;
            }
            shellSessionName = requestedSessionName;
          } else {
            shellSessionName = createNewShell ? createHubShellSessionName() : hubShellSessionName();
          }
        }

        try {
          if (shouldAwaitTerminalSkillSync(mode)) {
            await syncSkillLibraryForDrone({ droneId, droneEntry: d });
            await syncMcpServersForDrone({ droneId, droneEntry: d });
          }
          if (mode === 'agent') {
            await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: d });
          }
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(d);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            const sessionName = mode === 'agent' ? hubChatSessionName(chatName) : shellSessionName;
            if (mode === 'agent') await ensureChatEntry({ droneId, chatName });
            const agentCmd =
              mode === 'agent'
                ? await resolveChatTmuxCommand({ droneId, chatName })
                : resolveHostTerminalShellCommand(process.env);
            const launchScript = [
              'set -euo pipefail',
              ...managedEnvLines,
              `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
              `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
              `exec ${agentCmd}`,
            ].join('\n');
            try {
              await procStart(daemon.client, {
                session: sessionName,
                cmd: 'bash',
                args: ['-lc', launchScript],
                cwd,
                env: managedEnv,
                force: false,
                terminal: true,
              });
            } catch (e: any) {
              const msg = String(e?.message ?? e ?? '')
                .trim()
                .toLowerCase();
              if (msg.includes('already exists') || msg.includes('process already exists')) {
                // Reuse the existing session instead of restarting it and dropping user state.
              } else {
                throw e;
              }
            }
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              mode,
              chat: mode === 'agent' ? chatName : null,
              cwd,
              sessionName,
            });
            return;
          }

          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName, droneEntry, droneId: lockedId }: any) => {
              const idForOps =
                normalizeDroneIdentity(lockedId) ||
                normalizeDroneIdentity((droneEntry as any)?.id) ||
                droneId;
              if (mode === 'agent') {
                try {
                  await upgradeDroneDaemonInContainer({
                    containerName,
                    containerPort: Number((droneEntry as any)?.containerPort ?? 7777),
                  });
                } catch {
                  // Best-effort daemon refresh; continue if upgrade fails.
                }
                await ensureChatEntry({ droneId: idForOps, chatName });
                const tmuxCmd = await resolveChatTmuxCommand({ droneId: idForOps, chatName });
                const { sessionName } = await ensureHubChatSessionRunning({
                  containerName,
                  chatName,
                  command: tmuxCmd,
                  cwd,
                  envVars: runtimeEnv,
                });
                json(res, 200, {
                  ok: true,
                  id: idForOps,
                  name: droneName,
                  mode,
                  chat: chatName,
                  cwd,
                  sessionName,
                });
                return;
              }

              const sessionName = shellSessionName;
              await ensureHubSessionRunning({
                containerName,
                sessionName,
                command: resolveHubTerminalShellCommand(),
                cwd,
                envVars: runtimeEnv,
              });
              json(res, 200, {
                ok: true,
                id: idForOps,
                name: droneName,
                mode,
                chat: null,
                cwd,
                sessionName,
              });
            },
          );
          return;
        } catch (e: any) {
          json(res, 500, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
            mode,
            chat: mode === 'agent' ? chatName : null,
          });
          return;
        }
      }

      // GET /api/drones/:id/terminal/:session/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read output from a tmux-backed terminal session.
      if (
        method === 'DELETE' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            await procStop(daemon.client, { session: sessionName });
            json(res, 200, { ok: true, id: droneId, name: droneName, sessionName });
            return;
          }

          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: drone },
            async ({ containerName }: any) => {
              const cleanupScript = [
                'set -euo pipefail',
                `s=${bashQuote(sessionName)}`,
                'if tmux has-session -t "$s" 2>/dev/null; then',
                '  tmux kill-session -t "$s" 2>/dev/null || true',
                'fi',
                `rm -rf /dvm-data/dvm-sessions/${sessionName} /tmp/dvm-sessions/${sessionName} 2>/dev/null || true`,
              ].join('\n');
              const result = await dvmExec(containerName, 'bash', ['-lc', cleanupScript]);
              if (result.code !== 0) {
                throw new Error(
                  result.stderr ||
                    result.stdout ||
                    `failed to close terminal session ${sessionName}`,
                );
              }
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, sessionName });
          return;
        } catch (e: any) {
          json(res, 500, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
            sessionName,
          });
          return;
        }
      }

      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'output'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const viewRaw = String(u.searchParams.get('view') ?? 'log')
          .trim()
          .toLowerCase();
        const view = viewRaw === 'screen' ? 'screen' : 'log';
        const since = parseOptionalNonNegativeInt(sinceRaw);
        const maxBytes = clampIntParam(
          maxBytesRaw,
          HUB_WEB_TERMINAL_MAX_BYTES,
          1,
          HUB_WEB_TERMINAL_MAX_BYTES,
        );
        const tailLines = clampIntParam(
          tailRaw,
          HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
          0,
          HUB_WEB_TERMINAL_MAX_TAIL_LINES,
        );

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            const out = await droneTerminalOutput(daemon.client, {
              session: sessionName,
              view,
              since: since ?? 0,
              max: since != null ? maxBytes : Math.max(maxBytes, tailLines * 256),
              tail: tailLines,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              sessionName,
              view,
              offsetBytes: Number((out as any)?.nextOffset ?? 0),
              text: String((out as any)?.chunk ?? ''),
            });
            return;
          }

          const out = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: drone },
            async ({ containerName }: any) => {
              if (view === 'screen') {
                const n = Math.max(
                  20,
                  Math.min(5000, tailLines || HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES),
                );
                const screenScript = [
                  'set -euo pipefail',
                  `session=${JSON.stringify(sessionName)}`,
                  `n=${JSON.stringify(String(n))}`,
                  'tmux capture-pane -p -t "$session" -S "-$n" 2>/dev/null || tmux capture-pane -p -t "$session" 2>/dev/null || true',
                ].join('\n');
                const screenResult = await dvmExec(containerName, 'bash', ['-lc', screenScript]);
                if (screenResult.code !== 0) {
                  throw new Error(
                    (
                      screenResult.stderr ||
                      screenResult.stdout ||
                      'tmux capture-pane failed'
                    ).trim(),
                  );
                }
                const offset = await dvmSessionRead({
                  container: containerName,
                  session: sessionName,
                  since: Number.MAX_SAFE_INTEGER,
                  maxBytes: 1,
                });
                return { offsetBytes: offset.offsetBytes, text: screenResult.stdout || '' };
              }
              return await dvmSessionRead({
                container: containerName,
                session: sessionName,
                since,
                maxBytes: since != null ? maxBytes : undefined,
                tailLines: since != null ? undefined : tailLines,
              });
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, sessionName, view, ...out });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (isStaleDockerExecErrorMessage(msg)) {
            json(res, 409, {
              ok: false,
              code: 'STALE_TERMINAL_SESSION',
              error:
                'Terminal session was interrupted by a container restart. Reopen the terminal session.',
              detail: msg,
              id: droneId,
              name: droneName,
              sessionName,
            });
            return;
          }
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/terminal/:session/input
      // Sends raw text into a tmux-backed terminal session.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'input'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const data = typeof body?.data === 'string' ? body.data : '';
        if (!data) {
          json(res, 400, { ok: false, error: 'missing input data' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
          json(res, 413, { ok: false, error: 'input too large' });
          return;
        }

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            await droneTerminalInput(daemon.client, { session: sessionName, data });
          } else {
            await withLockedDroneContainer(
              { requestedDroneName: droneName, droneEntry: drone },
              async ({ containerName }: any) => {
                await dvmSessionType(containerName, sessionName, { text: data });
              },
            );
          }
          json(res, 202, {
            ok: true,
            id: droneId,
            name: droneName,
            sessionName,
            bytes: Buffer.byteLength(data, 'utf8'),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (isStaleDockerExecErrorMessage(msg)) {
            json(res, 409, {
              ok: false,
              code: 'STALE_TERMINAL_SESSION',
              error:
                'Terminal session was interrupted by a container restart. Reopen the terminal session.',
              detail: msg,
              id: droneId,
              name: droneName,
              sessionName,
            });
            return;
          }
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/open-terminal?mode=ssh|agent&chat=<chatName>
      // Opens a *real* terminal on the host machine (not a simulated web terminal).
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'open-terminal'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const modeRaw = String(u.searchParams.get('mode') ?? 'ssh')
          .trim()
          .toLowerCase();
        const mode = modeRaw === 'ssh' || modeRaw === 'agent' ? (modeRaw as 'ssh' | 'agent') : null;
        if (!mode) {
          json(res, 400, { ok: false, error: `invalid mode: ${modeRaw} (expected ssh|agent)` });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        const containerName =
          String((drone as any)?.containerName ?? (drone as any)?.name ?? droneId).trim() ||
          droneId;

        const chatName = String(u.searchParams.get('chat') ?? 'default').trim() || 'default';
        if (mode === 'agent') {
          await ensureChatEntry({ droneId, chatName });
        }
        await syncSkillLibraryForDrone({ droneId, droneEntry: drone });
        await syncMcpServersForDrone({ droneId, droneEntry: drone });
        await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: drone });

        // CLI-agnostic "continuation": keep one tmux session per chat.
        // This avoids relying on any CLI-specific resume flag.
        const sessionName = hubChatSessionName(chatName);
        const terminal = String(u.searchParams.get('terminal') ?? '').trim() || null;
        const markerBase =
          process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.trim()
            ? process.env.XDG_RUNTIME_DIR.trim()
            : os.tmpdir();
        const markerPath = `${markerBase}/drone-hub-terminal-${process.pid}-${crypto.randomBytes(4).toString('hex')}.ok`;
        const markerSnippet = `printf %s ok > ${bashQuote(markerPath)}`;
        const agentCmd =
          mode === 'agent'
            ? await resolveChatTmuxCommand({ droneId, chatName })
            : resolveHubAgentCommand();
        const agentSessionEnv = [
          // Match non-tmux-ish colors as closely as possible.
          'export TERM=xterm-256color',
          'export COLORTERM=truecolor',
        ].join('; ');
        const containerSessionEnv = buildContainerManagedEnvLines(drone).join('; ');
        const cwd = normalizeDroneUiCwdForRuntime(drone, u.searchParams.get('cwd') ?? null);

        if (runtime === 'host') {
          const manualSshCmd = `cd ${shellQuoteIfNeeded(cwd)} && exec bash -i`;
          const manualAgentCmd = `cd ${shellQuoteIfNeeded(cwd)} && exec ${agentCmd}`;
          const manualCommand = mode === 'ssh' ? manualSshCmd : manualAgentCmd;
          const command =
            mode === 'ssh'
              ? [
                  'set +e',
                  markerSnippet,
                  `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
                  'exec bash -i',
                ].join('; ')
              : [
                  'set +e',
                  markerSnippet,
                  `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
                  `exec ${agentCmd}`,
                ].join('; ');
          const launched = await spawnTerminalWithBash(command, { terminal, markerPath });
          if (!launched.ok) {
            json(res, 500, {
              ok: false,
              error: launched.error,
              command,
              manualCommand,
              chat: chatName,
              sessionName,
              note: 'You can run this command manually in a terminal.',
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            mode,
            chat: chatName,
            sessionName,
            command,
            manualCommand,
            launcher: launched.launcher,
          });
          return;
        }

        const manualSshCmd = buildDockerExecShellCommand(containerName, cwd);
        const sshCmd = manualSshCmd;
        const agentAttachCmd = buildDockerExecTmuxAttachCommand(containerName, sessionName);
        let agentPrepError: string | null = null;
        if (mode === 'agent') {
          const agentShell = `set -e; ${containerSessionEnv}; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`;
          try {
            await dvmSessionStart(containerName, sessionName, 'bash', ['-lc', agentShell], true);
            const tmuxTuneCommands = [
              ['set-option', '-g', 'status', 'off'],
              ['set-window-option', '-g', 'remain-on-exit', 'off'],
              ['set-option', '-g', 'default-terminal', 'xterm-256color'],
              [
                'set-option',
                '-ga',
                'terminal-overrides',
                ',xterm-256color:Tc,screen-256color:Tc,screen:Tc,xterm-kitty:Tc',
              ],
              [
                'set-option',
                '-ga',
                'terminal-features',
                ',xterm-256color:RGB,screen-256color:RGB,xterm-kitty:RGB',
              ],
            ];
            for (const tmuxArgs of tmuxTuneCommands) {
              // Best-effort: ignore tuning failures and continue.
              // eslint-disable-next-line no-await-in-loop
              await dvmExec(containerName, 'tmux', tmuxArgs);
            }
          } catch (e: any) {
            agentPrepError = e?.message ?? String(e);
          }
        }
        const manualAgentCmd = `${agentAttachCmd} || ${manualSshCmd}`;

        const manualCommand = mode === 'ssh' ? manualSshCmd : manualAgentCmd;
        const command =
          mode === 'ssh'
            ? [
                'set +e',
                // Marker: prove that bash actually started (used by the launcher).
                markerSnippet,
                sshCmd,
                'code=$?',
                'echo',
                'echo "SSH exited with code $code"',
                'exec bash',
              ].join('; ')
            : [
                'set +e',
                markerSnippet,
                `echo "Attaching Agent session (${sessionName})..."`,
                agentPrepError
                  ? `echo ${bashQuote(`Warning: failed to prepare Agent session: ${agentPrepError}`)}`
                  : '',
                `${agentAttachCmd} || true`,
                'echo',
                'echo "If attach failed, you can run manually:"',
                `echo ${bashQuote(agentAttachCmd)}`,
                'echo',
                'echo "Falling back to a shell..."',
                sshCmd,
                'code=$?',
                'echo',
                'echo "Exited with code $code"',
                // Keep the terminal open after detach/exit.
                'exec bash',
              ]
                .filter(Boolean)
                .join('; ');

        const launched = await spawnTerminalWithBash(command, { terminal, markerPath });
        if (!launched.ok) {
          json(res, 500, {
            ok: false,
            error: launched.error,
            command,
            manualCommand,
            chat: chatName,
            sessionName,
            note: 'You can run this command manually in a terminal.',
          });
          return;
        }

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          mode,
          chat: chatName,
          sessionName,
          command,
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
