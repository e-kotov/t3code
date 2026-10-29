import { browserProxyTabOptions } from "@t3tools/contracts";
import { getClientSettings } from "~/hooks/useSettings";

export function browserProxyOpenInput(override?: string) {
  const settings = getClientSettings().browserProxy;
  if (override === undefined && !settings.enabled) return {};
  const { proxyUrl } = browserProxyTabOptions(override ?? settings.url);
  return { proxyUrl };
}
