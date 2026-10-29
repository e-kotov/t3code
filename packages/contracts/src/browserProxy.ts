import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export function normalizeBrowserProxyUrl(value: string): string {
  if (value === "") return "";
  try {
    const url = new URL(value);
    if (
      value.length > 2_048 ||
      !/^(?:https?|socks5):\/\//i.test(value) ||
      /[\s\\;,]/.test(value) ||
      !["http:", "https:", "socks5:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash ||
      url.port === "0" ||
      (url.protocol === "socks5:" && !url.port)
    )
      throw new Error();
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new Error(
      "Use an HTTP, HTTPS or SOCKS5 proxy URL without credentials, a path or a query.",
    );
  }
}

export const BrowserProxyUrl = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((value) => {
    try {
      normalizeBrowserProxyUrl(value);
      return true;
    } catch {
      return "Invalid browser proxy URL.";
    }
  }),
);

export const BrowserProxySettings = Schema.Struct({
  enabled: Schema.Boolean,
  url: BrowserProxyUrl,
}).check(
  Schema.makeFilter((value) => !value.enabled || value.url !== "" || "Enter a proxy URL first."),
);
export type BrowserProxySettings = typeof BrowserProxySettings.Type;

export class BrowserProxyError extends Schema.TaggedError<BrowserProxyError>()("BrowserProxyError", {
  message: Schema.String,
}) {}

export const browserProxySettingsFields = {
  browserProxy: BrowserProxySettings.pipe(
    Schema.withDecodingDefault(Effect.succeed({ enabled: false, url: "" })),
  ),
};

export const browserProxyPatchFields = { browserProxy: Schema.optionalKey(BrowserProxySettings) };

export const browserProxyTabFields = { proxyUrl: Schema.optional(BrowserProxyUrl) };

export function browserProxyTabOptions(proxyUrl: string | undefined): {
  readonly proxyUrl?: string;
  readonly runtime?: "server";
  readonly headless?: boolean;
} {
  return proxyUrl === undefined
    ? {}
    : {
        proxyUrl: normalizeBrowserProxyUrl(proxyUrl),
        ...(proxyUrl ? { runtime: "server" as const, headless: true } : {}),
      };
}

export function isDirectBrowserTarget(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(/^(?:https?|file):\/\//i.test(value) ? value : `http://${value}`);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol === "file:" || /^\/api\/assets(?:\/|$)/.test(url.pathname)) return true;
    if (["localhost", "::1", "0.0.0.0"].includes(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".ts.net")) return true;
    const octets = host.split(".").map(Number);
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = octets;
      return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31) || (a === 169 && b === 254) || (a === 100 && b! >= 64 && b! <= 127);
    }
    return /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host);
  } catch {
    return false;
  }
}

export function resolveBrowserProxyRoute(url: string | undefined, override: string | undefined, defaultProxyUrl: string): string {
  return isDirectBrowserTarget(url) ? "" : normalizeBrowserProxyUrl(override ?? defaultProxyUrl);
}

export function browserProxyRequestReuse(input: {
  readonly proxyUrl?: string | undefined;
  readonly tabId?: string | undefined;
  readonly reuseExistingTab?: boolean | undefined;
}) {
  return input.reuseExistingTab ?? (input.proxyUrl === undefined || input.tabId !== undefined);
}
