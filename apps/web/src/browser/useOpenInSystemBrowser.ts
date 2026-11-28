import { AuthTerminalOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { isLoopbackHost } from "@t3tools/shared/preview";
import { msg } from "gt-react";

import { isElectron } from "~/env";
import { m } from "~/i18n/messages";
import { readLocalApi } from "~/localApi";
import { readEnvironment, useEnvironment } from "~/state/environments";
import {
  canForwardPorts,
  forwardedUrl,
  forwardPort,
  readForwardLocality,
  useForwardLocality,
} from "~/state/portForwards";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

import {
  resolveReachableExternalServerUrl,
  tunnelsEnvironmentLoopback,
} from "./browserTargetResolver";

/** The port of an http(s) URL on localhost, 127.0.0.1 or ::1; null for any other URL. */
export function loopbackWebPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!isLoopbackHost(parsed.hostname)) return null;
    return Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  } catch {
    return null;
  }
}

/**
 * Opens a URL from an environment's output in the system browser. That browser reaches another
 * machine's loopback only through a desktop forward or the environment's private address, so
 * those URLs open through one or not at all.
 */
export function useOpenInSystemBrowser(
  defaultEnvironmentId: EnvironmentId | null,
): (url: string, overrideEnvironmentId?: EnvironmentId) => Promise<void> {
  const defaultEnvironment = useEnvironment(defaultEnvironmentId);
  const defaultForwardable =
    useEnvironmentScope(defaultEnvironmentId, AuthTerminalOperateScope) &&
    defaultEnvironment?.connection.phase === "connected" &&
    canForwardPorts(defaultEnvironment);
  const defaultLocality = useForwardLocality(defaultForwardable ? defaultEnvironmentId : null);
  return async (url, overrideEnvironmentId) => {
    const environmentId = overrideEnvironmentId ?? defaultEnvironmentId;
    const api = readLocalApi();
    if (!api) throw new Error(m(msg("Link opening is unavailable.")));
    const port = loopbackWebPort(url);
    if (environmentId === null || port === null) {
      await api.shell.openExternal(url);
      return;
    }
    const unreachable = () =>
      new Error(
        m(
          msg(
            "localhost:{port} runs on another machine, and port forwarding isn't available for it right now.",
            { port },
          ),
        ),
      );
    if (!isElectron) {
      // No forward on the web: use the environment's own private address, or refuse.
      let reachable: string;
      try {
        reachable = resolveReachableExternalServerUrl(environmentId, url);
      } catch {
        throw unreachable();
      }
      await api.shell.openExternal(reachable);
      return;
    }
    const sameEnvironment = environmentId === defaultEnvironmentId;
    const environment = sameEnvironment ? defaultEnvironment : readEnvironment(environmentId);
    const forwardable = sameEnvironment
      ? defaultForwardable
      : readEnvironmentScope(environmentId, AuthTerminalOperateScope) &&
        environment?.connection.phase === "connected" &&
        canForwardPorts(environment);
    const locality = sameEnvironment
      ? defaultLocality
      : forwardable
        ? readForwardLocality(environmentId)
        : "unknown";
    if (locality === "local" || !tunnelsEnvironmentLoopback(environment?.entry.target)) {
      await api.shell.openExternal(url);
      return;
    }
    if (!forwardable) throw unreachable();
    // Starting a forward runs the probe; only a confirmed local environment opens directly.
    const forward = await forwardPort(environmentId, port);
    await api.shell.openExternal(forwardedUrl(forward, url));
  };
}
