import type { IssueDetail } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

const url = "https://github.com/owner/repo/issues/7";
const detail = vi.hoisted(() => ({
  tracker: "github",
  host: "github.com",
  scope: "owner/repo",
  key: "7",
  displayKey: "#7",
  title: "Something is broken",
  url: "https://github.com/owner/repo/issues/7",
  author: null,
  state: { category: "open", name: "Open" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
  assignees: [],
  labels: [],
  commentCount: 0,
  projectId: "project-1",
  projectTitle: "Project",
  writable: true,
  capabilities: {
    create: false,
    edit: true,
    comment: false,
    labels: true,
    assignees: true,
    reactions: false,
    templates: false,
    linkedPullRequests: false,
    events: false,
    search: false,
  },
  viewerPermissions: {
    setState: false,
    comment: false,
    edit: true,
    labels: true,
    assignees: true,
  },
  states: [],
  viewer: null,
  body: "",
  comments: [],
  commentsCursor: null,
  events: [],
  linkedPullRequests: [],
})) as unknown as IssueDetail;

const state = vi.hoisted(() => ({
  openLink: vi.fn(async () => {}),
  postComment: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
    _tag: "Success",
    value: undefined,
  })),
}));

vi.mock(import("~/state/use-atom-command"), async (original) => {
  const actual = await original();
  const { issueEnvironment } = await import("~/state/issues");
  return {
    ...actual,
    useAtomCommand: ((command, options) =>
      (command as unknown) === issueEnvironment.comment
        ? state.postComment
        : actual.useAtomCommand(command, options)) as typeof actual.useAtomCommand,
  };
});

vi.mock(import("~/browser/useOpenLink"), () => ({ useOpenLink: () => state.openLink }));
vi.mock(import("./IssueThreadLinks"), () => ({ IssueThreadLinks: (() => null) as never }));
vi.mock(import("~/state/issues"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const actual = await original();
  const detailAtom = Atom.make(AsyncResult.success(detail));
  const candidatesAtom = Atom.make(
    AsyncResult.success({
      labels: [
        { name: "bug", color: "d73a4a", description: null },
        { name: "docs", color: "0075ca", description: null },
      ],
      assignees: [
        { id: "1", login: "alice", name: null, avatarUrl: null },
        { id: "2", login: "bob", name: null, avatarUrl: null },
      ],
      truncated: false,
    }),
  );
  const allowed = Atom.make(true);
  return {
    ...actual,
    issueEnvironment: {
      ...actual.issueEnvironment,
      detail: (() => detailAtom) as never,
      candidates: (() => candidatesAtom) as never,
      comment: { ...actual.issueEnvironment.comment, permissionAtom: () => allowed },
    },
  };
});

import { RightPanelSheet } from "../RightPanelSheet";
import { IssueCommentComposer } from "./IssueCommentComposer";
import { IssueDetailPanel } from "./IssueDetailPanel";

const reference = {
  projectId: "project-1" as never,
  tracker: "github" as never,
  scope: "owner/repo",
  key: "7",
};

function setComments(comments: IssueDetail["comments"]) {
  state.openLink.mockClear();
  (detail as { comments: unknown }).comments = comments;
}

describe("IssueDetailPanel", () => {
  it("requires an explicit customer audience again for the next comment", async () => {
    state.postComment.mockClear();
    state.postComment.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail("Temporary error"),
    });
    await using screen = await render(
      <IssueCommentComposer
        environmentId={"env-1" as never}
        reference={reference}
        blocked={null}
        audiences
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Add a comment" });
    await userEvent.click(screen.getByRole("button", { name: "Internal note", exact: true }));
    await userEvent.click(page.getByRole("menuitemradio", { name: "Reply to customer" }));
    await userEvent.fill(editor, "Customer reply");
    await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
    await expect.element(editor).toHaveValue("Customer reply");
    await expect
      .element(screen.getByRole("button", { name: "Reply to customer", exact: true }))
      .toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
    await expect.element(editor).toHaveValue("");
    await expect
      .element(screen.getByRole("button", { name: "Internal note", exact: true }))
      .toBeVisible();
    await userEvent.fill(editor, "Private follow-up");
    await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
    expect(state.postComment.mock.calls.map(([call]) => call)).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({ body: "Customer reply", audience: "public" }),
      }),
      expect.objectContaining({
        input: expect.objectContaining({ body: "Customer reply", audience: "public" }),
      }),
      expect.objectContaining({
        input: expect.objectContaining({ body: "Private follow-up", audience: "internal" }),
      }),
    ]);
  });

  it("opens the issue number through the link-target setting, not a popup", async () => {
    setComments([]);
    const threadRef = { environmentId: "env-1", threadId: "thread-1" } as never;
    await using screen = await render(
      <IssueDetailPanel
        environmentId={"env-1" as never}
        reference={reference}
        threadRef={threadRef}
      />,
    );
    const number = screen.getByRole("link", { name: "Open #7 on GitHub" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    (await number.element()).dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(state.openLink).toHaveBeenCalledOnce();
    expect(state.openLink).toHaveBeenCalledWith(url, { event: expect.anything() });
  });

  it("opens a comment's timestamp through the link-target setting, not a popup", async () => {
    const commentUrl = `${url}#issuecomment-1`;
    setComments([
      {
        id: "1",
        author: null,
        body: "Same here",
        createdAt: "2026-01-02T00:00:00.000Z",
        url: commentUrl,
      },
    ]);
    await using screen = await render(
      <IssueDetailPanel
        environmentId={"env-1" as never}
        reference={reference}
        threadRef={{ environmentId: "env-1", threadId: "thread-1" } as never}
      />,
    );
    const link = await vi.waitFor(() => {
      const found = screen.container.querySelector(`a[href="${commentUrl}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(state.openLink).toHaveBeenCalledOnce();
    expect(state.openLink).toHaveBeenCalledWith(commentUrl, { event: expect.anything() });
  });

  it("Escape cancels the title edit without closing the right panel sheet", async () => {
    setComments([]);
    const onCloseSheet = vi.fn();
    await using _screen = await render(
      <RightPanelSheet animationDurationMs={0} open onClose={onCloseSheet}>
        <IssueDetailPanel environmentId={"env-1" as never} reference={reference} />
      </RightPanelSheet>,
    );
    await act(() =>
      (page.getByRole("button", { name: "Edit title" }).element() as HTMLElement).click(),
    );
    const input = page.getByRole("textbox", { name: "Issue title" });
    await expect.element(input).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await expect.element(input).not.toBeInTheDocument();
    expect(onCloseSheet).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onCloseSheet).toHaveBeenCalledTimes(1);
  });

  it("finds a label when the search has surrounding spaces", async () => {
    setComments([]);
    await using screen = await render(
      <IssueDetailPanel environmentId={"env-1" as never} reference={reference} />,
    );
    await screen.getByRole("combobox", { name: "Change labels" }).click();
    await userEvent.fill(page.getByRole("combobox", { name: "Search labels" }), " bug ");

    await expect.element(page.getByRole("option", { name: "bug" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "docs" })).not.toBeInTheDocument();
  });

  it("finds an assignee when the search has surrounding spaces", async () => {
    setComments([]);
    await using screen = await render(
      <IssueDetailPanel environmentId={"env-1" as never} reference={reference} />,
    );
    await screen.getByRole("combobox", { name: "Change assignees" }).click();
    await userEvent.fill(page.getByRole("combobox", { name: "Search people" }), " alice ");

    await expect.element(page.getByRole("option", { name: "alice" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "bob" })).not.toBeInTheDocument();
  });
});
