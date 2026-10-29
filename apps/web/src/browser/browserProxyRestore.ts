import type { PreviewSessionSnapshot } from "@t3tools/contracts";

export function browserProxyRestoreInput(snapshot: PreviewSessionSnapshot) {
  return {
    ...(snapshot.proxyUrl === undefined ? {} : { proxyUrl: snapshot.proxyUrl }),
    ...(snapshot.runtime === undefined ? {} : { runtime: snapshot.runtime }),
  };
}
