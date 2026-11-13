import { expect, it } from "vite-plus/test";
import { availableResetCount } from "./resetAvailability.logic";

it.each([
  { balances: [], expected: null },
  { balances: [undefined], expected: null },
  { balances: [0], expected: 0 },
  { balances: [1], expected: 1 },
  { balances: [1, 2], expected: 3 },
  { balances: [0, undefined], expected: 0 },
  { balances: [2, undefined], expected: 2 },
])("pools reported reset balances $balances as $expected", ({ balances, expected }) => {
  const accounts = balances.map((count) => ({
    limits: {
      checkedAt: "2026-11-13T16:00:00Z",
      windows: [],
      ...(count === undefined ? {} : { resetCredits: { availableCount: count } }),
    },
  }));
  expect(availableResetCount(accounts)).toBe(expected);
});
