import { readJsonBody, sendJson as json } from '../hub-http';
import {
  LocalCheckoutError,
  LocalCheckoutService,
} from '../local-checkout-service';
import type { LegacyRouteHandler } from './legacy-route';

function sendFailure(res: Parameters<typeof json>[0], error: unknown): void {
  if (error instanceof LocalCheckoutError) {
    json(res, error.status, { ok: false, error: error.message, code: error.code });
    return;
  }
  json(res, 500, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createLocalCheckoutRouteHandler(
  service: LocalCheckoutService,
): LegacyRouteHandler {
  return async ({ req, res, method, parts }) => {
    if (
      method === 'GET' &&
      parts.length === 2 &&
      parts[0] === 'api' &&
      parts[1] === 'local-checkout'
    ) {
      try {
        json(res, 200, await service.getView());
      } catch (error) {
        sendFailure(res, error);
      }
      return true;
    }

    if (
      method === 'PATCH' &&
      parts.length === 2 &&
      parts[0] === 'api' &&
      parts[1] === 'local-checkout'
    ) {
      try {
        const body = await readJsonBody(req);
        json(res, 200, await service.setAutoUpdates(body?.autoUpdates));
      } catch (error) {
        sendFailure(res, error);
      }
      return true;
    }

    if (
      method === 'POST' &&
      parts.length === 3 &&
      parts[0] === 'api' &&
      parts[1] === 'local-checkout'
    ) {
      try {
        if (parts[2] === 'update') {
          const body = await readJsonBody(req);
          const includeDirty =
            typeof body?.includeDirty === 'boolean' ? body.includeDirty : undefined;
          json(res, 200, await service.update({ includeDirty }));
          return true;
        }
        if (parts[2] === 'return') {
          json(res, 200, await service.returnToOriginal());
          return true;
        }
        if (parts[2] === 'apply') {
          const body = await readJsonBody(req);
          const droneId = String(body?.droneId ?? '').trim();
          json(res, 200, await service.prepareApply(droneId));
          return true;
        }
      } catch (error) {
        sendFailure(res, error);
        return true;
      }
    }

    if (
      method === 'POST' &&
      parts.length === 6 &&
      parts[0] === 'api' &&
      parts[1] === 'drones' &&
      parts[3] === 'repo' &&
      parts[4] === 'local' &&
      parts[5] === 'use'
    ) {
      try {
        const body = await readJsonBody(req);
        json(
          res,
          200,
          await service.useLocally(decodeURIComponent(parts[2]), {
            autoUpdates: body?.autoUpdates,
          }),
        );
      } catch (error) {
        sendFailure(res, error);
      }
      return true;
    }

    return false;
  };
}
