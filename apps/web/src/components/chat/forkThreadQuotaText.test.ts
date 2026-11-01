import type { ForkThreadQuota } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { quotaAmountText } from "./forkThreadQuotaText";

it("keeps zero, missing readings, partial values and percentages above 100 distinct", () => {
  const reading: ForkThreadQuota = {
    status: "available",
    checkedAt: "2026-10-31T12:00:00Z",
    dataAsOf: null,
    fiveHourPercent: 0,
    weeklyPercent: 150.25,
    balanceCredits: null,
  };
  expect(quotaAmountText(reading)).toBe("5h 0% · Weekly 150.25%");
  expect(quotaAmountText({ ...reading, status: "partial", weeklyPercent: null })).toBe("~5h 0%");
  expect(quotaAmountText({ ...reading, status: "unavailable" })).toBe("Not reported yet");
  expect(quotaAmountText({ ...reading, fiveHourPercent: null, weeklyPercent: null })).toBe(
    "Not reported yet",
  );
  expect(quotaAmountText({ ...reading, fiveHourPercent: 0.001, weeklyPercent: null })).toBe(
    "5h <0.01%",
  );
  expect(quotaAmountText({ ...reading, balanceCredits: "0E-10" })).toBe("5h 0% · Weekly 150.25%");
  const creditOnly = { ...reading, fiveHourPercent: null, weeklyPercent: null };
  expect(quotaAmountText({ ...creditOnly, balanceCredits: "0E-10" })).toBe("0 credits");
  expect(quotaAmountText({ ...creditOnly, balanceCredits: "12.3400000000" })).toBe("12.34 credits");
  expect(quotaAmountText({ ...creditOnly, balanceCredits: "-1E-18" })).toBe(
    "-0.000000000000000001 credits",
  );
});
