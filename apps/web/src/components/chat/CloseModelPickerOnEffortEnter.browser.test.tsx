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

it("closes on Enter when the effort column has no effort levels", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div>
        <input
          type="text"
          placeholder="Search models"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              events.push("model-selected");
            }
          }}
        />
        <div data-model-picker-effort>
          <CloseModelPickerOnEffortEnter
            onClose={() => {
              events.push("closed");
              setOpen(false);
            }}
          >
            <div>No effort levels</div>
          </CloseModelPickerOnEffortEnter>
        </div>
      </div>
    );
  }

  await using screen = await render(<Picker />);

  (screen.getByPlaceholder("Search models").element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["model-selected", "closed"]));
  await expect.element(page.getByPlaceholder("Search models")).not.toBeInTheDocument();
});

it("does not close on Enter when the effort column contains effort levels", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div>
        <input
          type="text"
          placeholder="Search models"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              events.push("model-selected");
            }
          }}
        />
        <div data-model-picker-effort>
          <CloseModelPickerOnEffortEnter
            onClose={() => {
              events.push("closed");
              setOpen(false);
            }}
          >
            <button type="button" data-effort-level>
              Medium
            </button>
          </CloseModelPickerOnEffortEnter>
        </div>
      </div>
    );
  }

  await using screen = await render(<Picker />);

  (screen.getByPlaceholder("Search models").element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["model-selected"]));
  await expect.element(page.getByPlaceholder("Search models")).toBeInTheDocument();
});

it("does not close on click when the effort column has no effort levels", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            events.push("model-clicked");
          }}
        >
          Gemini
        </button>
        <div data-model-picker-effort>
          <CloseModelPickerOnEffortEnter
            onClose={() => {
              events.push("closed");
              setOpen(false);
            }}
          >
            <div>No effort levels</div>
          </CloseModelPickerOnEffortEnter>
        </div>
      </div>
    );
  }

  await using screen = await render(<Picker />);

  await userEvent.click(screen.getByRole("button", { name: "Gemini" }));

  await vi.waitFor(() => expect(events).toEqual(["model-clicked"]));
  await expect.element(page.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
});
