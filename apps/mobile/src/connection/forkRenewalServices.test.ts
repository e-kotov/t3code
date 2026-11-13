import * as Http from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";
import { vi } from "vite-plus/test";

// Expo 58's native fetch fails on a redirect when asked to (ExpoURLSessionTask on iOS,
// OkHttp with redirects off on Android); Node's fetch does the same, so it stands in here.
vi.mock("expo/fetch", () => ({
  fetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
  type ConnectionRoute,
  CredentialStore,
  ForkCredentialCatalog,
  ForkDirectSessionRenewal,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import {
  type ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, FORK_SESSION_RENEWAL_PATH } from "@t3tools/contracts";

import { renewalServices } from "./forkRenewalServices";

const environmentId = EnvironmentId.make("environment-host");

/** React Native's global fetch: XMLHttpRequest follows redirects whatever `redirect` says. */
const reactNativeFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...init, redirect: "follow" });

const renewedTo = (token: string) =>
  JSON.stringify({
    status: "renewed",
    token,
    environmentId,
    expiresAt: "2026-12-13T00:00:00.000Z",
    expiresIn: 2_592_000,
  });

/** A loopback server recording each request it receives. */
const serve = (respond: (request: Http.IncomingMessage, response: Http.ServerResponse) => void) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly server: Http.Server;
      readonly url: string;
      readonly seen: Array<string>;
    }>((resume) => {
      const seen: Array<string> = [];
      const server = Http.createServer((request, response) => {
        seen.push(`${request.method} ${request.url}`);
        respond(request, response);
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resume(Effect.succeed({ server, url: `http://127.0.0.1:${port}/`, seen }));
      });
    }),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }),
  );

const answer = (body: string) => (_: Http.IncomingMessage, response: Http.ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(body);
};

/**
 * Renewal as the app mounts it: the runtime's client over React Native's fetch,
 * and this app's renewal services over a catalog holding the paired token.
 */
const renewalOver = Effect.fn(function* (httpBaseUrl: string) {
  let catalog: ConnectionCatalogDocument = {
    ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
    credentials: [
      { connectionId: "paired-1", credential: new BearerConnectionCredential({ token: "old" }) },
    ],
  };
  const store: ForkCredentialCatalog.CatalogStore<never> = {
    read: Effect.sync(() => catalog),
    update: (transform) =>
      Effect.sync(() => {
        catalog = transform(catalog);
      }),
  };
  const credentials = CredentialStore.make({
    get: (connectionId) =>
      Effect.sync(() =>
        Option.fromUndefinedOr(
          catalog.credentials.find((entry) => entry.connectionId === connectionId)?.credential,
        ),
      ),
    put: () => Effect.void,
    remove: () => Effect.void,
  });
  const httpClient = yield* Layer.build(layerRemoteHttpClient(reactNativeFetch)).pipe(
    Effect.map((context) => Context.get(context, HttpClient.HttpClient)),
  );
  const renewal = yield* ForkDirectSessionRenewal.make(httpClient).pipe(
    Effect.provideContext(
      Context.make(CredentialStore.ConnectionCredentialStore, credentials).pipe(
        renewalServices(store),
      ),
    ),
  );
  const route: ConnectionRoute = {
    target: new BearerConnectionTarget({ environmentId, label: "Host", connectionId: "paired-1" }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: "paired-1",
        environmentId,
        label: "Host",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
  const prepared: PreparedConnection = {
    environmentId,
    label: "Host",
    httpBaseUrl,
    socketUrl: "ws://unused/ws",
    httpAuthorization: { _tag: "Bearer", token: "old" },
    target: route.target,
  };
  return {
    renewNow: renewal.renewNow(route, prepared),
    token: () => catalog.credentials[0]?.credential.token,
  };
});

describe("mobile session renewal", () => {
  it.live("renews through Expo's native fetch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* serve(answer(renewedTo("renewed")));
        const renewal = yield* renewalOver(host.url);
        expect(yield* renewal.renewNow).toBe("again");
        expect(host.seen).toEqual([`POST ${FORK_SESSION_RENEWAL_PATH}`]);
        expect(renewal.token()).toBe("renewed");
      }),
    ),
  );

  it.live("never follows a redirect, though React Native's own fetch would", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const elsewhere = yield* serve(answer(renewedTo("from-elsewhere")));
        const host = yield* serve((request, response) => {
          response.writeHead(307, { location: new URL(request.url ?? "/", elsewhere.url).href });
          response.end();
        });
        const renewal = yield* renewalOver(host.url);
        expect(yield* renewal.renewNow).toBe("again");
        expect(host.seen).toEqual([`POST ${FORK_SESSION_RENEWAL_PATH}`]);
        expect(elsewhere.seen).toEqual([]);
        expect(renewal.token()).toBe("old");
      }),
    ),
  );
});
