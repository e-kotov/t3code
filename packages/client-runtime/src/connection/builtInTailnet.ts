/** Embedded routes keep saved route identity and credentials; forwarded loopback addresses never persist. */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import { type ConnectionAttemptError, ConnectionTransientError } from "./model.ts";
import {
  connectionRouteId,
  connectionRouteKind,
  connectionRoutes,
  entryWithRoutes,
} from "./routes.ts";

/**
 * Where the embedded node goes among an environment's saved routes, which
 * keep their own order. The "Tailscale app route" is the saved tailnet
 * address the node forwards to, reachable directly while the Tailscale app's
 * VPN is on.
 */
export type BuiltInTailnetPosition = "first" | "before-tailscale" | "after-tailscale" | "last";
export type BuiltInTailnetMode = "off" | BuiltInTailnetPosition;

export interface BuiltInTailnet {
  /** Read on every attempt, so a settings change applies to the next one. */
  readonly mode: () => BuiltInTailnetMode;
  /**
   * Starts the embedded node if needed and returns the loopback port for each
   * target ("host:port"). Targets it cannot serve now, for example before
   * sign-in, are missing from the map.
   */
  readonly forward: (targets: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, number>>;
}

/**
 * The tailnet "host:port" a route reaches, or null when the embedded node
 * cannot carry it. Only plain http routes qualify: a forward ends at
 * 127.0.0.1, which an https certificate for the tailnet name would reject.
 */
export function builtInTailnetTarget(route: ConnectionRoute): string | null {
  if (route.target._tag !== "BearerConnectionTarget") return null;
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile" || profile.authorization !== undefined) {
    return null;
  }
  // A bare 100.64.0.0/10 address counts as "vpn" unless the server reported it
  // as Tailscale; if it belongs to another VPN, the embedded dial just fails.
  const kind = connectionRouteKind(route);
  if (kind !== "tailnet" && kind !== "vpn") return null;
  let url: URL;
  try {
    url = new URL(profile.httpBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  return `${url.hostname}:${url.port === "" ? "80" : url.port}`;
}

/** `baseUrl` with its host replaced by 127.0.0.1:`port`, keeping scheme and path. */
function loopbackUrl(baseUrl: string, port: number): string {
  const url = new URL(baseUrl);
  const rest = baseUrl.slice(baseUrl.indexOf(url.host) + url.host.length);
  return `${url.protocol}//127.0.0.1:${port}${rest}`;
}

/** The same route, addressed through a loopback forward. */
export function forwardedRoute(route: ConnectionRoute, port: number): ConnectionRoute {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return route;
  return {
    target: route.target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: profile.connectionId,
        environmentId: profile.environmentId,
        label: profile.label,
        httpBaseUrl: loopbackUrl(profile.httpBaseUrl, port),
        wsBaseUrl: loopbackUrl(profile.wsBaseUrl, port),
        ...(profile.learned === undefined ? {} : { learned: profile.learned }),
        ...(profile.network === undefined ? {} : { network: profile.network }),
      }),
    ),
  };
}

/** The entry's tailnet routes addressed through `ports`, or none if no route has a port. */
function forwardedEntry(
  entry: ConnectionCatalogEntry,
  ports: ReadonlyMap<string, number>,
): Option.Option<ConnectionCatalogEntry> {
  const routes = connectionRoutes(entry).flatMap((route) => {
    const target = builtInTailnetTarget(route);
    const port = target === null ? undefined : ports.get(target);
    return port === undefined ? [] : [forwardedRoute(route, port)];
  });
  return routes.length === 0 ? Option.none() : Option.some(entryWithRoutes(entry, routes));
}

function builtInTargets(entry: ConnectionCatalogEntry): ReadonlyArray<string> {
  const targets = new Set<string>();
  for (const route of connectionRoutes(entry)) {
    const target = builtInTailnetTarget(route);
    if (target !== null) targets.add(target);
  }
  return [...targets];
}

/** The saved routes tried before the embedded node, and those tried after it. */
export function splitAtBuiltIn(
  routes: ReadonlyArray<ConnectionRoute>,
  position: BuiltInTailnetPosition,
): {
  readonly before: ReadonlyArray<ConnectionRoute>;
  readonly after: ReadonlyArray<ConnectionRoute>;
} {
  const carried = routes.map((route) => builtInTailnetTarget(route) !== null);
  const at =
    position === "first"
      ? 0
      : position === "last"
        ? routes.length
        : position === "before-tailscale"
          ? Math.max(carried.indexOf(true), 0)
          : carried.lastIndexOf(true) + 1;
  return { before: routes.slice(0, at), after: routes.slice(at) };
}

export function withBuiltInTailnet(
  driver: ConnectionDriver.ConnectionDriver["Service"],
  tailnet: BuiltInTailnet,
): ConnectionDriver.ConnectionDriver["Service"] {
  type Connect = ConnectionDriver.ConnectionDriver["Service"]["connect"];
  // Environments whose current connection runs through the embedded node.
  const onBuiltIn = new Set<string>();

  /** Connects through the embedded node; none when it cannot serve this entry now. */
  const connectBuiltIn = Effect.fnUntraced(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: Parameters<Connect>[1],
    targets: ReadonlyArray<string>,
  ) {
    const ports = yield* tailnet.forward(targets);
    const forwarded = forwardedEntry(entry, ports);
    if (Option.isNone(forwarded)) return Option.none();
    return Option.some(yield* driver.connect(forwarded.value, reportProgress).pipe(Effect.result));
  });

  /** Whether any of the routes answers its reachability check, or has none. */
  const anyAnswers = (entry: ConnectionCatalogEntry) =>
    Effect.forEach(connectionRoutes(entry), (route) => driver.checkRoute(entry, route), {
      concurrency: "unbounded",
    }).pipe(Effect.map((checks) => checks.some((check) => check !== "silent")));

  const connect: Connect = Effect.fn("BuiltInTailnet.connect")(function* (
    entry: Parameters<Connect>[0],
    reportProgress: Parameters<Connect>[1],
  ) {
    const mode = tailnet.mode();
    const environmentId = entry.target.environmentId;
    const targets = builtInTargets(entry);
    onBuiltIn.delete(environmentId);
    if (mode === "off" || targets.length === 0) {
      return yield* driver.connect(entry, reportProgress);
    }
    const { before, after } = splitAtBuiltIn(connectionRoutes(entry), mode);
    let failure: ConnectionAttemptError | undefined;
    // Saved routes ahead of the node are tried only if one answers: waiting
    // out silent ones would delay the node. They get a last chance below.
    let deferred: ReadonlyArray<ConnectionRoute> = [];
    if (before.length > 0) {
      const ahead = entryWithRoutes(entry, before);
      if (yield* anyAnswers(ahead)) {
        const result = yield* driver.connect(ahead, reportProgress).pipe(Effect.result);
        if (result._tag === "Success") return result.success;
        // An incompatible server is the same server on every route.
        if (result.failure.reason === "unsupported") return yield* result.failure;
        failure = result.failure;
      } else {
        deferred = before;
      }
    }
    const builtIn = yield* connectBuiltIn(entry, reportProgress, targets);
    if (Option.isSome(builtIn)) {
      const result = builtIn.value;
      if (result._tag === "Success") {
        onBuiltIn.add(environmentId);
        return result.success;
      }
      if (result.failure.reason === "unsupported") return yield* result.failure;
      yield* Effect.logInfo("Built-in Tailscale route did not connect.", {
        detail: result.failure.detail,
      });
      failure ??= result.failure;
    }
    const rest = [...after, ...deferred];
    if (rest.length > 0) return yield* driver.connect(entryWithRoutes(entry, rest), reportProgress);
    return yield* (
      failure ??
        new ConnectionTransientError({
          reason: "endpoint-unavailable",
          detail: `${entry.target.label} did not answer on any route.`,
        })
    );
  });

  /**
   * Whether `route`, ranked above the route in use, should replace it. While
   * on the embedded node, only saved routes placed ahead of it count. While on
   * a saved route, a tailnet route below the node's position also counts when
   * the node can reach it, so the connection returns to the node.
   */
  const preflight = Effect.fn("builtInTailnet.preflight")((
    entry: ConnectionCatalogEntry,
    route: ConnectionRoute,
  ) => {
    const mode = tailnet.mode();
    if (mode === "off") return driver.preflight(entry, route);
    const { before } = splitAtBuiltIn(connectionRoutes(entry), mode);
    const id = connectionRouteId(route.target);
    const aheadOfBuiltIn = before.some((saved) => connectionRouteId(saved.target) === id);
    if (onBuiltIn.has(entry.target.environmentId)) {
      return aheadOfBuiltIn ? driver.preflight(entry, route) : Effect.succeed(false);
    }
    const target = builtInTailnetTarget(route);
    if (aheadOfBuiltIn || target === null) return driver.preflight(entry, route);
    return driver.preflight(entry, route).pipe(
      Effect.flatMap((direct) =>
        direct
          ? Effect.succeed(true)
          : tailnet.forward([target]).pipe(
              Effect.flatMap((ports) => {
                const port = ports.get(target);
                return port === undefined
                  ? Effect.succeed(false)
                  : driver.preflight(entry, forwardedRoute(route, port));
              }),
            ),
      ),
    );
  });

  return ConnectionDriver.ConnectionDriver.of({
    connect,
    checkRoute: driver.checkRoute,
    preflight,
  });
}

/** The connection driver, wrapped to route through an embedded Tailscale node. */
export function layerDriver(tailnet: BuiltInTailnet) {
  return Layer.effect(
    ConnectionDriver.ConnectionDriver,
    ConnectionDriver.make.pipe(Effect.map((driver) => withBuiltInTailnet(driver, tailnet))),
  );
}
