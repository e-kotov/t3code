import { normalizeBrowserProxyUrl } from "@t3tools/contracts";
import { getClientSettings } from "~/hooks/useSettings";

export function browserProxyOpenInput(override?: string) {
  const settings = getClientSettings().browserProxy;
  if (override === undefined && !settings.enabled) return {};
  return { proxyUrl: normalizeBrowserProxyUrl(override ?? settings.url) };
}
