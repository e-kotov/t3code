import type { IncomingShareDestination } from "./incoming-share-model";

export function sameForkShareDestination(
  left: IncomingShareDestination,
  right: IncomingShareDestination,
): boolean {
  return left.environmentId === right.environmentId &&
    left.projectId === right.projectId && left.threadId === right.threadId;
}
