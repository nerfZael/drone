export type MobileFileCacheContext = {
  targetId: string;
  droneId: string;
  chatName: string;
  phoneTarget: boolean;
  path: string;
};

export function mobileFileCacheKey(context: MobileFileCacheContext): string {
  return context.phoneTarget
    ? `${context.targetId}\0${context.droneId}\0${context.chatName}\0${context.path}`
    : `${context.targetId}\0${context.droneId}\0${context.path}`;
}

export function mobileDirectoryCacheKey(context: {
  targetId: string;
  droneId: string;
  chatName: string;
  rootPath: string;
}): string {
  return context.rootPath
    ? `${context.targetId}\0${context.droneId}\0${context.rootPath}`
    : `${context.targetId}\0${context.droneId}\0${context.chatName}\0${context.rootPath}`;
}
