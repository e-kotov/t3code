import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";
import {
  CloseModelPickerOnEffortEnter,
  closeModelPickerOnEffortEnter,
} from "./CloseModelPickerOnEffortEnter";

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
      <div data-model-picker-content>
        <input
          type="text"
          placeholder="Search models"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              events.push("model-selected");
            }
          }}
        />
        <div role="option" data-highlighted>
          Claude Sonnet 3.5
        </div>
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

it("closes on Enter when focused on a model option with no effort levels", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <button
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => events.push("model-chosen")}
        >
          Claude 3.5 Haiku
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

  (screen.getByRole("option", { name: "Claude 3.5 Haiku" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["model-chosen", "closed"]));
  await expect
    .element(page.getByRole("option", { name: "Claude 3.5 Haiku" }))
    .not.toBeInTheDocument();
});

it("does not close on Enter when the effort column contains effort levels", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <input
          type="text"
          placeholder="Search models"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              events.push("model-selected");
              document.querySelector<HTMLElement>("[data-effort-level]")?.focus();
            }
          }}
        />
        <div role="option" data-highlighted>
          Claude Sonnet 3.7
        </div>
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
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Medium" }).element());
});

it("does not close on Enter in search when there are 0 matching models", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <input
          type="text"
          placeholder="Search models"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              events.push("enter-in-search");
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

  await vi.waitFor(() => expect(events).toEqual(["enter-in-search"]));
  await expect.element(page.getByPlaceholder("Search models")).toBeInTheDocument();
});

it("does not close on Enter during IME composition", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <input type="text" placeholder="Search models" />
        <div role="option" data-highlighted>
          Claude 3.5 Sonnet
        </div>
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

  const input = screen.getByPlaceholder("Search models").element() as HTMLInputElement;
  input.focus();

  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ...nativeEvent,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(event);
    });
    expect(events).toEqual([]);
    await expect.element(page.getByPlaceholder("Search models")).toBeInTheDocument();
  }
  await expect.element(page.getByPlaceholder("Search models")).toBeInTheDocument();
});

it("does not close on Enter on a sidebar provider button", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <div data-model-picker-sidebar>
          <button
            type="button"
            data-model-picker-provider="anthropic"
            onClick={() => events.push("provider-selected")}
          >
            Anthropic
          </button>
        </div>
        <div role="option">Claude 3.5 Sonnet</div>
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

  const sidebarButton = screen.getByRole("button", { name: "Anthropic" }).element() as HTMLElement;
  sidebarButton.focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["provider-selected"]));
  await expect.element(page.getByRole("button", { name: "Anthropic" })).toBeInTheDocument();
});

it("does not close on Enter on legacy section toggle row", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <button
          type="button"
          role="option"
          aria-expanded={false}
          onClick={() => events.push("legacy-toggled")}
        >
          Show more
        </button>
        <div role="option">Claude 3.5 Sonnet</div>
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

  const toggleButton = screen.getByRole("option", { name: "Show more" }).element() as HTMLElement;
  toggleButton.focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["legacy-toggled"]));
  await expect.element(page.getByRole("option", { name: "Show more" })).toBeInTheDocument();
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

it("closes real ProviderModelPicker on Enter for a model with no effort levels", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      [
        { slug: "plain", name: "Plain model" },
        { slug: "old", name: "Old model", isLegacy: true },
      ],
    ],
  ]);

  function Picker() {
    const [model, setModel] = useState("plain");
    const [open, setOpen] = useState(false);
    return (
      <>
        <span data-testid="state">{open ? "OPEN" : "CLOSED"}</span>
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={instanceId}
          model={model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={options as never}
          triggerAriaLabel="Choose model"
          open={open}
          onOpenChange={setOpen}
          onInstanceModelChange={(_, selected) => setModel(selected)}
          {...closeModelPickerOnEffortEnter({
            effortColumn: <div>No options</div>,
            onOpenChange: setOpen,
          })}
        />
      </>
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect.element(page.getByTestId("state")).toHaveTextContent("CLOSED"));
});

it("keeps real ProviderModelPicker open when pressing Enter on Show more", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      [
        { slug: "plain", name: "Plain model" },
        { slug: "old", name: "Old model", isLegacy: true },
      ],
    ],
  ]);

  function Picker() {
    const [model, setModel] = useState("plain");
    const [open, setOpen] = useState(false);
    return (
      <>
        <span data-testid="state">{open ? "OPEN" : "CLOSED"}</span>
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={instanceId}
          model={model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={options as never}
          triggerAriaLabel="Choose model"
          open={open}
          onOpenChange={setOpen}
          onInstanceModelChange={(_, selected) => setModel(selected)}
          {...closeModelPickerOnEffortEnter({
            effortColumn: <div>No options</div>,
            onOpenChange: setOpen,
          })}
        />
      </>
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  await expect.element(search).toHaveFocus();
  await expect.element(page.getByRole("option", { name: /Show more/ })).toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(page.getByRole("option", { name: /Show more/ }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByTestId("state")).toHaveTextContent("OPEN");
  await expect.element(page.getByRole("option", { name: /Old model/ })).toBeInTheDocument();
});

it("does not close on Enter when focused on a favorite button", async () => {
  const events: string[] = [];

  function Picker() {
    const [open, setOpen] = useState(true);
    if (!open) return null;

    return (
      <div data-model-picker-content>
        <div role="option">
          <span>Claude 3.5 Sonnet</span>
          <button
            type="button"
            aria-label="Add to favorites"
            onClick={() => events.push("favorite-clicked")}
          >
            Star
          </button>
        </div>
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

  const favButton = screen
    .getByRole("button", { name: "Add to favorites" })
    .element() as HTMLElement;
  favButton.focus();
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(events).toEqual(["favorite-clicked"]));
  await expect.element(page.getByRole("button", { name: "Add to favorites" })).toBeInTheDocument();
});
