import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  type BuiltInTailnetMode,
  builtInTailnetTarget,
  forwardedRoute,
  splitAtBuiltIn,
  withBuiltInTailnet,
} from "./builtInTailnet.ts";
import { BearerConnectionProfile, type ConnectionRoute } from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  RelayConnectionTarget,
} from "./model.ts";
import { connectionRoutes, entryWithRoutes, routeHttpBaseUrl } from "./routes.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function direct(
  id: string,
  httpBaseUrl: string,
  extra: { readonly network?: "tailscale"; readonly authorization?: "t3-connect" } = {},
): ConnectionRoute {
  return {
    target: new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "GWDG",
      connectionId: id,
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: ENVIRONMENT_ID,
        label: "GWDG",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
        ...extra,
      }),
    ),
  };
}

const SSH_TUNNEL_URL = "http://127.0.0.1:3774";
const TAILNET_URL = "http://100.124.207.131:3773";
const SSH_TUNNEL = direct("ssh-tunnel", SSH_TUNNEL_URL);
const TAILNET = direct("tailnet", TAILNET_URL);
const ENTRY = entryWithRoutes(
  { target: SSH_TUNNEL.target, profile: SSH_TUNNEL.profile, enabled: true },
  [SSH_TUNNEL, TAILNET],
);
const FORWARD_PORT = 41000;
const FORWARDED_URL = `http://127.0.0.1:${FORWARD_PORT}`;

const lease = {} as ConnectionDriver.EnvironmentConnectionLease;
const transient = new ConnectionTransientError({ reason: "network", detail: "refused" });

/**
 * A driver whose routes answer and connect as scripted, keyed by base URL,
 * recording the base URLs of each attempt in order.
 */
function fakeDriver(script: {
  readonly answers: ReadonlySet<string>;
  readonly connects: ReadonlySet<string>;
  readonly unsupported?: boolean;
}) {
  const attempts: Array<ReadonlyArray<string | null>> = [];
  const driver = ConnectionDriver.ConnectionDriver.of({
    preflight: (_entry, route) =>
      Effect.succeed(script.answers.has(routeHttpBaseUrl(route) ?? "") ? "ready" : "silent"),
    checkHost: (prepared) =>
      Effect.succeed(script.answers.has(prepared.httpBaseUrl) ? "answered" : "silent"),
    connect: (entry) => {
      const urls = connectionRoutes(entry).map(routeHttpBaseUrl);
      attempts.push(urls);
      if (script.unsupported) {
        return Effect.fail(new ConnectionBlockedError({ reason: "unsupported", detail: "old" }));
      }
      return urls.some((url) => script.connects.has(url ?? ""))
        ? Effect.succeed(lease)
        : Effect.fail(transient);
    },
  });
  return { driver, attempts };
}

function fakeTailnet(mode: BuiltInTailnetMode, available = true) {
  const forwards: Array<ReadonlyArray<string>> = [];
  return {
    forwards,
    tailnet: {
      mode: () => mode,
      forward: (targets: ReadonlyArray<string>) => {
        forwards.push(targets);
        return Effect.succeed(
          new Map(available ? targets.map((target) => [target, FORWARD_PORT] as const) : []),
        );
      },
    },
  };
}

const connect = (driver: ConnectionDriver.ConnectionDriver["Service"]) =>
  Effect.scoped(driver.connect(ENTRY, () => Effect.void)).pipe(Effect.result);

describe("built-in Tailscale routes", () => {
  it("carries plain http tailnet and 100.64/10 routes only", () => {
    expect(builtInTailnetTarget(TAILNET)).toBe("100.124.207.131:3773");
    expect(
      builtInTailnetTarget(
        direct("dns", "http://ionos.tail1234.ts.net:3773", { network: "tailscale" }),
      ),
    ).toBe("ionos.tail1234.ts.net:3773");
    expect(builtInTailnetTarget(direct("https", "https://desk.tail1234.ts.net/"))).toBeNull();
    expect(builtInTailnetTarget(SSH_TUNNEL)).toBeNull();
    expect(builtInTailnetTarget(direct("lan", "http://192.168.1.10:3773"))).toBeNull();
    expect(
      builtInTailnetTarget(
        direct("connect", "http://100.124.207.131:3773", { authorization: "t3-connect" }),
      ),
    ).toBeNull();
    expect(
      builtInTailnetTarget({
        target: new RelayConnectionTarget({ environmentId: ENVIRONMENT_ID, label: "GWDG" }),
        profile: Option.none(),
      }),
    ).toBeNull();
  });

  it("keeps the route id and path when forwarding", () => {
    const route = forwardedRoute(direct("tailnet", "http://100.64.0.9:3773/t3/"), 41000);
    expect(route.target._tag === "BearerConnectionTarget" && route.target.connectionId).toBe(
      "tailnet",
    );
    const profile = Option.getOrThrow(route.profile);
    expect(profile._tag === "BearerConnectionProfile" && profile.httpBaseUrl).toBe(
      "http://127.0.0.1:41000/t3/",
    );
    expect(profile._tag === "BearerConnectionProfile" && profile.wsBaseUrl).toBe(
      "ws://127.0.0.1:41000/t3/",
    );
  });

  it.effect("last uses a working saved route without starting the engine", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL]),
        connects: new Set([SSH_TUNNEL_URL]),
      });
      const { tailnet, forwards } = fakeTailnet("last");
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Success");
      expect(forwards).toEqual([]);
      expect(attempts).toEqual([[SSH_TUNNEL_URL, TAILNET_URL]]);
    }),
  );

  it.effect("last tries the engine after the saved routes fail", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL]),
        connects: new Set([FORWARDED_URL]),
      });
      const { tailnet } = fakeTailnet("last");
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Success");
      expect(attempts).toEqual([[SSH_TUNNEL_URL, TAILNET_URL], [FORWARDED_URL]]);
    }),
  );

  it.effect("last goes to the engine first when no saved route answers", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set(),
        connects: new Set([FORWARDED_URL]),
      });
      const { tailnet } = fakeTailnet("last");
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Success");
      expect(attempts).toEqual([[FORWARDED_URL]]);
    }),
  );

  it.effect("first falls back to the saved routes when the engine cannot serve", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL]),
        connects: new Set([SSH_TUNNEL_URL]),
      });
      const { tailnet, forwards } = fakeTailnet("first", false);
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Success");
      expect(forwards).toEqual([["100.124.207.131:3773"]]);
      expect(attempts).toEqual([[SSH_TUNNEL_URL, TAILNET_URL]]);
    }),
  );

  it.effect("off leaves the driver alone", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({ answers: new Set(), connects: new Set() });
      const { tailnet, forwards } = fakeTailnet("off");
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Failure");
      expect(forwards).toEqual([]);
      expect(attempts).toEqual([[SSH_TUNNEL_URL, TAILNET_URL]]);
    }),
  );

  it.effect("an incompatible server is not retried through the engine", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL]),
        connects: new Set(),
        unsupported: true,
      });
      const { tailnet, forwards } = fakeTailnet("last");
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag === "Failure" && result.failure.reason).toBe("unsupported");
      expect(forwards).toEqual([]);
      expect(attempts).toHaveLength(1);
    }),
  );

  it("places the engine among the saved routes", () => {
    const LAN = direct("lan", "http://192.168.1.10:3773");
    const ids = (routes: ReadonlyArray<ConnectionRoute>) =>
      routes.map((route) =>
        route.target._tag === "BearerConnectionTarget" ? route.target.connectionId : "",
      );
    const routes = [SSH_TUNNEL, TAILNET, LAN];
    const split = (position: Parameters<typeof splitAtBuiltIn>[1]) => {
      const { before, after } = splitAtBuiltIn(routes, position);
      return [ids(before), ids(after)];
    };
    expect(split("first")).toEqual([[], ["ssh-tunnel", "tailnet", "lan"]]);
    expect(split("before-tailscale")).toEqual([["ssh-tunnel"], ["tailnet", "lan"]]);
    expect(split("after-tailscale")).toEqual([["ssh-tunnel", "tailnet"], ["lan"]]);
    expect(split("last")).toEqual([["ssh-tunnel", "tailnet", "lan"], []]);
  });

  it.effect("before the Tailscale app route: SSH, then the engine, then the app route", () =>
    Effect.gen(function* () {
      const { driver, attempts } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL]),
        connects: new Set([TAILNET_URL]),
      });
      const { tailnet } = fakeTailnet("before-tailscale", false);
      const result = yield* connect(withBuiltInTailnet(driver, tailnet));
      expect(result._tag).toBe("Success");
      expect(attempts).toEqual([[SSH_TUNNEL_URL], [TAILNET_URL]]);
    }),
  );

  it.effect("on the engine, only saved routes placed ahead of it count as better", () =>
    Effect.gen(function* () {
      const { driver } = fakeDriver({
        answers: new Set([SSH_TUNNEL_URL, FORWARDED_URL]),
        connects: new Set([FORWARDED_URL]),
      });
      const first = withBuiltInTailnet(driver, fakeTailnet("first").tailnet);
      expect((yield* connect(first))._tag).toBe("Success");
      expect(yield* first.preflight(ENTRY, SSH_TUNNEL)).toBe("unchecked");
      const before = withBuiltInTailnet(driver, fakeTailnet("before-tailscale").tailnet);
      expect((yield* connect(before))._tag).toBe("Success");
      expect(yield* before.preflight(ENTRY, SSH_TUNNEL)).toBe("ready");
    }),
  );

  it.effect("on a saved route, the engine counts as better when placed ahead", () =>
    Effect.gen(function* () {
      const { driver } = fakeDriver({ answers: new Set([FORWARDED_URL]), connects: new Set() });
      const first = withBuiltInTailnet(driver, fakeTailnet("first").tailnet);
      expect(yield* first.preflight(ENTRY, TAILNET)).toBe("ready");
      const last = withBuiltInTailnet(driver, fakeTailnet("last").tailnet);
      expect(yield* last.preflight(ENTRY, TAILNET)).toBe("silent");
    }),
  );

  it.effect("checks a live session's host on the origin it connected through", () =>
    Effect.gen(function* () {
      type Prepared = Parameters<ConnectionDriver.ConnectionDriver["Service"]["checkHost"]>[0];
      const { driver } = fakeDriver({ answers: new Set([FORWARDED_URL]), connects: new Set() });
      const engine = withBuiltInTailnet(driver, fakeTailnet("first").tailnet);
      const session = (httpBaseUrl: string) => ({ httpBaseUrl }) as Prepared;
      expect(yield* engine.checkHost(session(FORWARDED_URL))).toBe("answered");
      expect(yield* engine.checkHost(session(TAILNET_URL))).toBe("silent");
    }),
  );
});
