import {
  AuthPreviewOperateScope,
  type BetterWrightViewerFallbackAvailability,
  type BetterWrightViewerFallbackState,
  type EnvironmentId,
} from "@t3tools/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { useEnvironmentScope } from "~/state/session";

import { readViewerFallbackLeaseUrl, viewerFallbackBridge } from "./betterWrightSshFallbackAccess";
import {
  initialStreamHealth,
  type StreamHealth,
  streamConnectionChanged,
  streamFramed,
  streamNeedsFallback,
  streamRefused,
} from "./betterWrightSshFallbackHealth";

const HEALTH_CHECK_MS = 2_000;

interface StreamHealthReporter {
  readonly connected: (connected: boolean) => void;
  readonly frame: () => void;
  readonly unauthorized: () => void;
}

type SshFallbackNoticeView =
  | { readonly _tag: "Offer"; readonly sshHost: string; readonly opening: boolean }
  | { readonly _tag: "Unavailable"; readonly reason: string }
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Open"; readonly sshHost: string | null }
  | { readonly _tag: "Problem"; readonly message: string };

const remoteMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': (?:\w+: )?/, "")
    : "The SSH viewer could not be opened.";

function SshFallbackNotice(props: {
  readonly view: SshFallbackNoticeView;
  readonly onOpen: () => void;
  readonly onComplete: () => void;
  readonly onClose: () => void;
  readonly onDismiss: () => void;
}) {
  const { view } = props;
  const actions = (() => {
    switch (view._tag) {
      case "Offer":
        return (
          <Button size="xs" disabled={view.opening} onClick={props.onOpen}>
            Open over SSH
          </Button>
        );
      case "Connecting":
        return (
          <Button variant="outline" size="xs" onClick={props.onClose}>
            Cancel
          </Button>
        );
      case "Open":
        return (
          <>
            <Button size="xs" onClick={props.onComplete}>
              Done, release to agent
            </Button>
            <Button variant="outline" size="xs" onClick={props.onClose}>
              Close window
            </Button>
          </>
        );
      case "Problem":
        return (
          <Button variant="outline" size="xs" onClick={props.onDismiss}>
            Dismiss
          </Button>
        );
      case "Unavailable":
        return null;
    }
  })();
  const text = (() => {
    switch (view._tag) {
      case "Offer":
        return `The browser stream is not arriving. If this is an agent browser handoff, you can open it in a separate window over SSH through ${view.sshHost}.`;
      case "Unavailable":
        return `The browser stream is not arriving. ${view.reason}`;
      case "Connecting":
        return "Opening the browser handoff over SSH…";
      case "Open":
        return `The handoff is open in a separate window${view.sshHost ? ` over SSH through ${view.sshHost}` : " over SSH"}. Stay on the requested page, then release it to the agent here.`;
      case "Problem":
        return view.message;
    }
  })();
  return (
    <div
      data-testid="betterwright-ssh-fallback"
      className="visible absolute inset-x-2 bottom-2 z-30 flex flex-col gap-2 rounded-md border border-border bg-background p-2 text-xs text-muted-foreground shadow-sm"
    >
      <p role="status">{text}</p>
      {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Desktop-only fallback for an agent browser handoff whose in-T3 stream fails. The server still
 * authorizes it and the desktop picks the SSH host; web and mobile clients render nothing.
 */
export function useSshViewerFallback(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly tabId: string;
  readonly visible: boolean;
  /** The stream was refused or needs host setup: never offer a way around that. */
  readonly refused: boolean;
}): { readonly stream: StreamHealthReporter; readonly overlay: ReactNode } {
  const { environmentId, threadId, tabId, visible, refused } = input;
  const bridge = viewerFallbackBridge();
  // Web and mobile never read the session for this: they have no fallback to offer.
  const canOperate = useEnvironmentScope(bridge ? environmentId : null, AuthPreviewOperateScope);
  const healthRef = useRef<StreamHealth | null>(null);
  const [stream] = useState<StreamHealthReporter>(() => {
    const apply = (next: (health: StreamHealth, now: number) => StreamHealth) => {
      const now = Date.now();
      healthRef.current = next(healthRef.current ?? initialStreamHealth(now), now);
    };
    return {
      connected: (connected) =>
        apply((health, now) => streamConnectionChanged(health, connected, now)),
      frame: () => {
        const health = healthRef.current;
        // Called per frame: allocate only on the first one.
        if (health?.framed && !health.refusing) return;
        apply(streamFramed);
      },
      unauthorized: () => apply(streamRefused),
    };
  });
  const [unhealthy, setUnhealthy] = useState(false);
  const [availability, setAvailability] = useState<BetterWrightViewerFallbackAvailability | null>(
    null,
  );
  const [session, setSession] = useState<BetterWrightViewerFallbackState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const watching = bridge !== undefined && visible && !refused && canOperate;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the stream reporter on a timer; frames arrive outside React
  useEffect(() => {
    if (!watching) return;
    if (healthRef.current === null) healthRef.current = initialStreamHealth(Date.now());
    const check = () => {
      const health = healthRef.current;
      setUnhealthy(health !== null && streamNeedsFallback(health, Date.now()));
    };
    const timer = setInterval(check, HEALTH_CHECK_MS);
    return () => clearInterval(timer);
  }, [watching]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the desktop's SSH viewer sessions for this tab
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const receive = (state: BetterWrightViewerFallbackState) => {
      const sameTab =
        state.environmentId === environmentId &&
        state.threadId === threadId &&
        state.tabId === tabId;
      if (!active || !sameTab) return;
      setSession(state.phase === "connecting" || state.phase === "open" ? state : null);
      if (state.phase === "failed" || (state.phase === "closed" && state.message !== null))
        setProblem(state.message);
    };
    const unsubscribe = bridge.onState(receive);
    void bridge.sessions().then(
      (states) => states.forEach(receive),
      () => undefined,
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, environmentId, threadId, tabId]);

  const offered = watching && unhealthy && session === null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the desktop for this environment's saved SSH route when the offer appears
  useEffect(() => {
    if (!offered || !bridge) return;
    let active = true;
    void bridge.availability(environmentId).then(
      (next) => {
        if (active) setAvailability(next);
      },
      () => {
        if (active) setAvailability(null);
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, environmentId, offered]);

  if (!bridge) return { stream, overlay: null };

  const open = () => {
    setOpening(true);
    setProblem(null);
    void readViewerFallbackLeaseUrl({ environmentId, threadId, tabId })
      .then((leaseUrl) => {
        if (leaseUrl === null) {
          setProblem(
            "T3 could not authorize the SSH viewer over this connection. Reconnect to the environment and try again.",
          );
          return;
        }
        return bridge.open({ environmentId, threadId, tabId, leaseUrl }).then(() => undefined);
      })
      .catch((cause: unknown) => setProblem(remoteMessage(cause)))
      .then(() => setOpening(false));
  };
  const run = (action: Promise<void>) =>
    void action.catch((cause: unknown) => setProblem(remoteMessage(cause)));

  const view: SshFallbackNoticeView | null =
    session?.phase === "connecting"
      ? { _tag: "Connecting" }
      : session?.phase === "open"
        ? {
            _tag: "Open",
            sshHost: availability?.available ? availability.sshHost : null,
          }
        : problem !== null
          ? { _tag: "Problem", message: problem }
          : offered && availability
            ? availability.available
              ? { _tag: "Offer", sshHost: availability.sshHost, opening }
              : { _tag: "Unavailable", reason: availability.reason }
            : null;

  return {
    stream,
    overlay:
      view === null ? null : (
        <SshFallbackNotice
          view={view}
          onOpen={open}
          onComplete={() => session && run(bridge.complete(session.sessionId))}
          onClose={() => session && run(bridge.close(session.sessionId))}
          onDismiss={() => setProblem(null)}
        />
      ),
  };
}
