import {
  browserProxyRequestReuse,
  normalizeBrowserProxyUrl,
  type PreviewAutomationOpenInput,
} from "@t3tools/contracts";

export function resolveBrowserProxyOpen(
  input: PreviewAutomationOpenInput,
  defaultProxyUrl: string,
) {
  return {
    proxyUrl: normalizeBrowserProxyUrl(input.proxyUrl ?? defaultProxyUrl),
    reuse: browserProxyRequestReuse(input),
  };
}
