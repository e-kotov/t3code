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

export const browserProxySettingsFields = {
  browserProxy: BrowserProxySettings.pipe(
    Schema.withDecodingDefault(Effect.succeed({ enabled: false, url: "" })),
  ),
};

export const browserProxyPatchFields = { browserProxy: Schema.optionalKey(BrowserProxySettings) };

export const browserProxyTabFields = { proxyUrl: Schema.optional(BrowserProxyUrl) };

export function browserProxyTabOptions(proxyUrl: string | undefined) {
  return proxyUrl === undefined
    ? {}
    : {
        proxyUrl: normalizeBrowserProxyUrl(proxyUrl),
        ...(proxyUrl ? { runtime: "server" as const, headless: true } : {}),
      };
}

export function browserProxyRequestReuse(input: {
  readonly proxyUrl?: string | undefined;
  readonly tabId?: string | undefined;
  readonly reuseExistingTab?: boolean | undefined;
}) {
  return input.reuseExistingTab ?? (input.proxyUrl === undefined || input.tabId !== undefined);
}
