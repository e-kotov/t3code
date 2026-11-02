import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { CloseModelPickerOnEffortEnter } from "./CloseModelPickerOnEffortEnter";

it("applies an effort level before closing on Enter", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <CloseModelPickerOnEffortEnter
        onClose={() => {
          events.push("closed");
          setOpen(false);
        }}
      >
        <button type="button" data-effort-level onClick={() => events.push("selected")}>
          High
        </button>
      </CloseModelPickerOnEffortEnter>
    );
  }

  await using screen = await render(<Picker />);

  (screen.getByRole("button", { name: "High" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["selected", "closed"]));
  await expect.element(page.getByRole("button", { name: "High" })).not.toBeInTheDocument();
});
