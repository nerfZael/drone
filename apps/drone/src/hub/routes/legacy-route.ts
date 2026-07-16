import type { IncomingMessage, ServerResponse } from 'node:http';

export interface LegacyRouteRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  parts: string[];
}

export type LegacyRouteHandler = (request: LegacyRouteRequest) => Promise<boolean>;

/**
 * Transitional contract for slices still backed by functions in server.ts.
 * The key union makes the injection surface exact while domain services are
 * extracted and can replace the individual function members with richer types.
 */
export type LegacyRouteDependencyContract<Name extends string> = {
  [Key in Name]: any;
};
