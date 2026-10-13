import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { BearerConnectionProfile, SshConnectionProfile } from "./catalog.ts";
import { BearerConnectionTarget, SshConnectionTarget } from "./model.ts";
import { connectionRoutes } from "./routes.ts";
import { relabelCatalogEntry } from "./serverLabel.ts";

const environmentId = EnvironmentId.make("gwdg");
const sshTarget = new SshConnectionTarget({ environmentId, label: "gfn1012", connectionId: "ssh" });
const sshProfile = new SshConnectionProfile({
  connectionId: "ssh",
  environmentId,
  label: "gfn1012",
  target: { alias: "gwdg", hostname: "gwdg.example.test", username: "u", port: 22 },
});
const bearerTarget = new BearerConnectionTarget({
  environmentId,
  label: "gfn1012",
  connectionId: "lan",
});
const bearerProfile = new BearerConnectionProfile({
  connectionId: "lan",
  environmentId,
  label: "gfn1012",
  httpBaseUrl: "http://10.0.0.2:3773",
  wsBaseUrl: "ws://10.0.0.2:3773",
  learned: true,
});
const entry = {
  target: sshTarget,
  profile: Option.some(sshProfile),
  alternateRoutes: [{ target: bearerTarget, profile: Option.some(bearerProfile) }],
  enabled: true,
};

describe("relabelCatalogEntry", () => {
  it("renames every route's target and profile, keeping their other fields", () => {
    const next = relabelCatalogEntry(entry, "  GWDG ");
    expect(next).not.toBeNull();
    const routes = connectionRoutes(next!);
    expect(routes.map((route) => route.target.label)).toEqual(["GWDG", "GWDG"]);
    expect(routes.map((route) => Option.getOrThrow(route.profile).label)).toEqual(["GWDG", "GWDG"]);
    expect(routes[0]!.target).toBeInstanceOf(SshConnectionTarget);
    expect(routes[1]!.target).toMatchObject({
      _tag: "BearerConnectionTarget",
      connectionId: "lan",
    });
    expect(Option.getOrThrow(routes[1]!.profile)).toMatchObject({
      _tag: "BearerConnectionProfile",
      httpBaseUrl: "http://10.0.0.2:3773",
      learned: true,
    });
    expect(Option.getOrThrow(routes[0]!.profile)).toMatchObject({ target: sshProfile.target });
    expect(next!.enabled).toBe(true);
  });

  it("returns null when the name is unchanged or blank", () => {
    expect(relabelCatalogEntry(entry, "gfn1012")).toBeNull();
    expect(relabelCatalogEntry(entry, "   ")).toBeNull();
  });

  it("renames a route without a profile", () => {
    const next = relabelCatalogEntry(
      { target: bearerTarget, profile: Option.none(), enabled: true },
      "GWDG",
    );
    expect(next?.target.label).toBe("GWDG");
    expect(Option.isNone(next!.profile)).toBe(true);
  });
});
