import type { HubRouter } from '../hub-router';
import { WindowLayoutPresetStore } from '../WindowLayoutPresetStore';

export function registerWindowLayoutPresetRoutes(router: HubRouter): void {
  // Lazy initialization avoids opening another database until presets are used.
  let store: WindowLayoutPresetStore | undefined;
  const getStore = () => store ??= new WindowLayoutPresetStore();
  router.get('/api/window-layout-presets', ({ json }) => {
    json(200, { presets: getStore().list() });
  });
  router.put('/api/window-layout-presets/:slot', async ({ params, readJson, json, fail }) => {
    const body = await readJson<{ layout?: unknown }>();
    try { getStore().save(params.slot, body?.layout); }
    catch (error) {
      if (error instanceof Error && (error.message.startsWith('Invalid window') || error.message.startsWith('Preset slot'))) {
        return fail(400, error.message);
      }
      throw error;
    }
    json(200, { ok: true });
  });
}
