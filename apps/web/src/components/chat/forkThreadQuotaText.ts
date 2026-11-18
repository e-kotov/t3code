import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
import type { ForkThreadQuota } from "@t3tools/contracts";

const ZERO_CREDITS = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i;

function creditAmountText(value: string): string {
  if (ZERO_CREDITS.test(value)) return "0";
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0
    ? numeric.toLocaleString("en-US", { maximumSignificantDigits: 6 })
    : value;
}

export function quotaAmountText(reading: ForkThreadQuota, resolve: MessageResolver = m): string {
  if (reading.status === "error") return resolve(msg("Unavailable"));
  if (reading.status === "unavailable") return resolve(msg("Not reported yet"));
  const parts: string[] = [];
  const format = (value: number) =>
    value > 0 && value < 0.01
      ? "<0.01"
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (reading.fiveHourPercent !== null)
    parts.push(resolve(msg("5h {percent}%", { percent: format(reading.fiveHourPercent) })));
  if (reading.weeklyPercent !== null)
    parts.push(resolve(msg("Weekly {percent}%", { percent: format(reading.weeklyPercent) })));
  if (
    reading.balanceCredits !== null &&
    (parts.length === 0 || !ZERO_CREDITS.test(reading.balanceCredits))
  )
    parts.push(
      resolve(msg("{credits} credits", { credits: creditAmountText(reading.balanceCredits) })),
    );
  return parts.length
    ? `${reading.status === "partial" ? "~" : ""}${parts.join(" · ")}`
    : resolve(msg("Not reported yet"));
}
