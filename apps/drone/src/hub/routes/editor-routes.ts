import { EditorRouteService } from '../editor-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type EditorDependencyName =
  | 'dockerContainerId'
  | 'droneRuntime'
  | 'normalizeDroneUiCwdForRuntime'
  | 'resolveDroneOrRespond';

export type EditorRouteDependencies = LegacyRouteDependencyContract<EditorDependencyName>;

export function createEditorRouteHandler(deps: EditorRouteDependencies): LegacyRouteHandler {
  return new EditorRouteService(deps).handle;
}
