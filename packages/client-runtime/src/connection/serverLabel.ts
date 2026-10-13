// Fork: a saved environment takes the name its server reports on every connect,
// so a server that moves between hosts (a GWDG Slurm job) or is renamed with
// T3CODE_ENVIRONMENT_LABEL does not keep the name it had when it was paired.
// A name typed into the client is replaced too; name the server instead.
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  SshConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionProfile,
  type ConnectionRoute,
} from "./catalog.ts";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
} from "./model.ts";
import { connectionRoutes, entryWithRoutes } from "./routes.ts";

function relabelTarget(target: ConnectionTarget, label: string): ConnectionTarget {
  switch (target._tag) {
    case "PrimaryConnectionTarget": {
      const { _tag, ...fields } = target;
      return new PrimaryConnectionTarget({ ...fields, label });
    }
    case "BearerConnectionTarget": {
      const { _tag, ...fields } = target;
      return new BearerConnectionTarget({ ...fields, label });
    }
    case "RelayConnectionTarget": {
      const { _tag, ...fields } = target;
      return new RelayConnectionTarget({ ...fields, label });
    }
    case "SshConnectionTarget": {
      const { _tag, ...fields } = target;
      return new SshConnectionTarget({ ...fields, label });
    }
  }
}

function relabelProfile(profile: ConnectionProfile, label: string): ConnectionProfile {
  if (profile._tag === "BearerConnectionProfile") {
    const { _tag, ...fields } = profile;
    return new BearerConnectionProfile({ ...fields, label });
  }
  const { _tag, ...fields } = profile;
  return new SshConnectionProfile({ ...fields, label });
}

/**
 * The entry with every route's target and profile named `label`, or `null`
 * when the server name is blank or every route already carries it.
 */
export function relabelCatalogEntry(
  entry: ConnectionCatalogEntry,
  label: string,
): ConnectionCatalogEntry | null {
  const name = label.trim();
  const routes = connectionRoutes(entry);
  if (
    name === "" ||
    routes.every(
      (route) =>
        route.target.label === name &&
        Option.match(route.profile, { onNone: () => true, onSome: (p) => p.label === name }),
    )
  ) {
    return null;
  }
  return entryWithRoutes(
    entry,
    routes.map((route): ConnectionRoute => ({
      target: relabelTarget(route.target, name),
      profile: Option.map(route.profile, (profile) => relabelProfile(profile, name)),
    })),
  );
}
