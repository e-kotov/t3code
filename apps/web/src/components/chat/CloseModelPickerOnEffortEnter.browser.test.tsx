import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { CloseModelPickerOnEffortEnter } from "./CloseModelPickerOnEffortEnter";

it("applies an effort level before closing on Enter", async () => {
  const events: string[] = [];
  await using screen = await render(
    <CloseModelPickerOnEffortEnter onClose={() => events.push("closed")}>
      <button type="button" data-effort-level onClick={() => events.push("selected")}>
        High
      </button>
    </CloseModelPickerOnEffortEnter>,
  );

  (screen.getByRole("button", { name: "High" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  expect(events).toEqual(["selected", "closed"]);
  expect(screen.getByRole("button", { name: "High" })).toBeInTheDocument();
});
