import type { LimitPace } from "@t3tools/shared/usageLimits";

const LABEL = { ahead: "Ahead of pace", on: "On pace", under: "Under pace" } as const;

export function UsagePaceLabel({ pace }: { readonly pace: LimitPace | null }) {
  return pace ? <span className="text-xs text-muted-foreground">{LABEL[pace]}</span> : null;
}
