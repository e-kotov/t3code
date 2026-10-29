import { BrowserProxyError } from "@t3tools/contracts";
import { browserProxyTargetError } from "@t3tools/shared/browserProxy";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { toastManager } from "~/components/ui/toast";

const isProxyError = Schema.is(BrowserProxyError);

export function reportBrowserProxyFailure(cause: Cause.Cause<unknown>): boolean {
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure) || !isProxyError(failure.value)) return false;
  toastManager.add({
    type: "error",
    title: "Browser proxy unavailable",
    description: failure.value.message,
  });
  return true;
}

export function reportBrowserProxyNavigationError(proxyUrl: string | undefined, url: string) {
  const blocked = browserProxyTargetError(url, proxyUrl ?? "");
  return blocked ? reportBrowserProxyFailure(Cause.fail(blocked)) : false;
}
