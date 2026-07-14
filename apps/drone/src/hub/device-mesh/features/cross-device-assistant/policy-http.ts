import type http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from '../../device-mesh-http';
import { CrossDeviceAssistantPolicyStore } from './policy-store';

const execFileAsync = promisify(execFile);

async function chooseDirectory(): Promise<string> {
  const attempts: Array<{ command: string; args: string[] }> =
    process.platform === 'darwin'
      ? [
          {
            command: 'osascript',
            args: [
              '-e',
              'POSIX path of (choose folder with prompt "Choose a Drone Hub workspace")',
            ],
          },
        ]
      : process.platform === 'win32'
        ? [
            {
              command: 'powershell.exe',
              args: [
                '-NoProfile',
                '-Command',
                "$s=New-Object -ComObject Shell.Application;$f=$s.BrowseForFolder(0,'Choose a Drone Hub workspace',0);if($f){$f.Self.Path}",
              ],
            },
          ]
        : [
            {
              command: 'zenity',
              args: ['--file-selection', '--directory', '--title=Choose a Drone Hub workspace'],
            },
            {
              command: 'kdialog',
              args: ['--getexistingdirectory', '.', '--title', 'Choose a Drone Hub workspace'],
            },
          ];
  for (const attempt of attempts) {
    try {
      const result = await execFileAsync(attempt.command, attempt.args, {
        timeout: 5 * 60_000,
        encoding: 'utf8',
      });
      const selected = String(result.stdout ?? '').trim();
      if (selected) return path.resolve(selected);
    } catch (error: any) {
      if (typeof error?.code === 'number') {
        // A chooser normally exits non-zero with no diagnostic when the user cancels. On
        // Linux, a diagnostic usually means this chooser cannot start, so try the fallback.
        if (process.platform !== 'linux' || !String(error?.stderr ?? '').trim())
          throw new Error('Folder selection was cancelled.');
      }
    }
  }
  throw new Error(
    process.platform === 'linux'
      ? 'No desktop folder chooser is available. Install zenity or kdialog, or configure the policy on a desktop Hub.'
      : 'The folder chooser was cancelled or unavailable.',
  );
}

export class CrossDeviceAssistantPolicyHttp implements DeviceMeshHttpExtension {
  constructor(
    private readonly policies: CrossDeviceAssistantPolicyStore,
    private readonly listRemoteWorkspaces?: (targetDeviceId: string) => Promise<unknown>,
  ) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname === '/api/device-mesh/cross-device-assistant/pick-directory') {
      if (request.method !== 'POST') {
        deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
        return true;
      }
      deviceMeshJson(response, 200, { ok: true, path: await chooseDirectory() });
      return true;
    }
    if (url.pathname === '/api/device-mesh/cross-device-assistant/remote-workspaces') {
      if (request.method !== 'GET') {
        deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
        return true;
      }
      const deviceId = String(url.searchParams.get('deviceId') ?? '').trim();
      if (!deviceId || !this.listRemoteWorkspaces) throw new Error('target device is required');
      deviceMeshJson(response, 200, {
        ok: true,
        result: await this.listRemoteWorkspaces(deviceId),
      });
      return true;
    }
    if (url.pathname !== '/api/device-mesh/cross-device-assistant') return false;
    if (request.method === 'GET') {
      deviceMeshJson(response, 200, { ok: true, policy: await this.policies.read() });
      return true;
    }
    if (request.method === 'PUT') {
      deviceMeshJson(response, 200, {
        ok: true,
        policy: await this.policies.replace(await readDeviceMeshBody(request)),
      });
      return true;
    }
    deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
    return true;
  }
}
