import type { ForkThreadQuota } from "@t3tools/contracts";

const ZERO_CREDITS = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i;

function creditAmountText(value: string): string {
  if (ZERO_CREDITS.test(value)) return "0";
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0
    ? numeric.toLocaleString("en-US", { maximumSignificantDigits: 6 })
    : value;
}

export function quotaAmountText(reading: ForkThreadQuota): string {
  if (reading.status === "error") return "Unavailable";
  if (reading.status === "unavailable") return "Not reported yet";
  const parts: string[] = [];
  const format = (value: number) =>
    value > 0 && value < 0.01
      ? "<0.01"
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (reading.fiveHourPercent !== null) parts.push(`5h ${format(reading.fiveHourPercent)}%`);
  if (reading.weeklyPercent !== null) parts.push(`Weekly ${format(reading.weeklyPercent)}%`);
  if (
    reading.balanceCredits !== null &&
    (parts.length === 0 || !ZERO_CREDITS.test(reading.balanceCredits))
  )
    parts.push(`${creditAmountText(reading.balanceCredits)} credits`);
  return parts.length
    ? `${reading.status === "partial" ? "~" : ""}${parts.join(" · ")}`
    : "Not reported yet";
}
