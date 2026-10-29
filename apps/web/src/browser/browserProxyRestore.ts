import type { PreviewSessionSnapshot } from "@t3tools/contracts";

export function browserProxyRestoreInput(snapshot: PreviewSessionSnapshot) {
  return {
    proxyUrl: snapshot.proxyUrl ?? "",
    ...(snapshot.runtime === undefined ? {} : { runtime: snapshot.runtime }),
  };
}
