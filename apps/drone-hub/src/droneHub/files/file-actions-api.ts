import { requestJson } from '../http';

export type DroneFsAction =
  | 'create-file'
  | 'create-directory'
  | 'rename'
  | 'delete'
  | 'move'
  | 'copy';

export type DroneFsActionPayload =
  | { action: 'create-file' | 'create-directory'; targetDir: string; name: string }
  | { action: 'rename'; path: string; name: string }
  | { action: 'delete'; paths: string[] }
  | { action: 'move' | 'copy'; paths: string[]; targetDir: string };

export type DroneFsActionResponse =
  | {
      ok: true;
      id: string;
      name: string;
      action: DroneFsAction;
      path?: string;
      targetPath?: string;
      paths?: string[];
      targetDir?: string;
    }
  | { ok: false; error: string; id?: string; name?: string };

export function runDroneFsAction(droneId: string, payload: DroneFsActionPayload): Promise<Extract<DroneFsActionResponse, { ok: true }>> {
  return requestJson<Extract<DroneFsActionResponse, { ok: true }>>(
    `/api/drones/${encodeURIComponent(droneId)}/fs/action`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}
