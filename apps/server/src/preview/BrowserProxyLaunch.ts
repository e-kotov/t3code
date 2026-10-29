import { normalizeBrowserProxyUrl } from "@t3tools/contracts";

export function browserProxyLaunchOptions(proxyUrl?: string) {
  const server = normalizeBrowserProxyUrl(proxyUrl ?? "");
  return server
    ? {
        proxy: {
          server,
          bypass:
            "localhost,*.localhost,*.local,*.ts.net,127.0.0.0/8,[::1],0.0.0.0,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,fc00::/7,fe80::/10",
        },
      }
    : {};
}

export function browserProxyContextOptions(proxyUrl?: string) {
  // Service workers can bypass Playwright's signed-asset request guard.
  return proxyUrl ? { serviceWorkers: "block" as const } : {};
}
