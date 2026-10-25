import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { cliReleaseIndexPageUrl } from "@t3tools/shared/forkCliRelease";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { resolveNewestVersion } from "./update.ts";

it.effect("finds EK releases through authenticated fork pagination", () =>
  Effect.gen(function* () {
    const pages: string[] = [];
    const httpClient = HttpClient.make((request) => {
      const url = new URL(request.url);
      assert.equal(url.pathname, "/repos/e-kotov/t3code/releases");
      assert.equal(request.headers.authorization, "Bearer gh-token");
      const page = url.searchParams.get("page") ?? "";
      pages.push(page);
      const tag_name = page === "1" ? "v1.2.4-nightly.20260101.1" : "v1.2.3-ek.2";
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json([{ tag_name }])));
    });
    const version = yield* resolveNewestVersion("ek", cliReleaseIndexPageUrl).pipe(
      Effect.provideService(HostProcess.Environment, { GH_TOKEN: "gh-token" }),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    assert.equal(version, "1.2.3-ek.2");
    assert.deepStrictEqual(pages, ["1", "2"]);
  }),
);
