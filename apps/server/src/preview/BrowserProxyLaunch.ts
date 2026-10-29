import { normalizeBrowserProxyUrl } from "@t3tools/contracts";

export function browserProxyLaunchOptions(proxyUrl?: string) {
  const server = normalizeBrowserProxyUrl(proxyUrl ?? "");
  return server
    ? {
        proxy: {
          server,
          bypass: [
            "<local>",
            "localhost",
            "*.localhost",
            "*.local",
            "home.arpa",
            "*.home.arpa",
            "*.ts.net",
            "0.0.0.0/8",
            "127.0.0.0/8",
            "[::]",
            "[::1]",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "100.64.0.0/10",
            "169.254.0.0/16",
            "198.18.0.0/15",
            "fc00::/7",
            "fe80::/10",
            "::ffff:0:0/104",
            "::ffff:7f00:0/104",
            "::ffff:a00:0/104",
            "::ffff:ac10:0/108",
            "::ffff:c0a8:0/112",
            "::ffff:6440:0/106",
            "::ffff:a9fe:0/112",
            "::ffff:c612:0/111",
          ].join(","),
        },
      }
    : {};
}

export function browserProxyContextOptions(proxyUrl?: string) {
  // Service workers can bypass Playwright's signed-asset request guard.
  return proxyUrl ? { serviceWorkers: "block" as const } : {};
}
