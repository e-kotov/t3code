import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({Platform: {OS: "android"}}));
vi.mock("../../lib/rootNavigation", () => ({rootNavigationRef: {getRootState: () => undefined, dispatch: vi.fn()}}));
vi.mock("../../state/atom-registry", async () => {
  const {AtomRegistry} = await import("effect/reactivity");
  return {appAtomRegistry: AtomRegistry.make()};
});
vi.mock("../../state/projects", async () => {const {Atom} = await import("effect/reactivity"); return {environmentProjects: {projectAtom: () => Atom.make(null)}};});
vi.mock("../../state/threads", async () => {const {Atom} = await import("effect/reactivity"); return {environmentThreadShells: {quietThreadShellsAtom: Atom.make([]), threadShellAtom: () => Atom.make(null)}};});
vi.mock("../../state/queued-run-edit", () => ({getQueuedRunEdit: () => null}));
vi.mock("../../state/use-composer-drafts", () => ({waitForComposerDraftsLoaded: async () => {}}));
vi.mock("../../connection/catalog", async () => {const {Atom} = await import("effect/reactivity"); return {environmentCatalog: {catalogValueAtom: Atom.make({entries: new Map()})}};});
vi.mock("../workspace/workspace-detail-selection", () => ({selectWorkspaceDetail: vi.fn()}));

import {appAtomRegistry} from "../../state/atom-registry";
import {forkShareDestinations, makeForkIncomingShareImports, presentForkShareDestinations} from "./forkShareDestinations";
import {isForkShareSubmissionLocked} from "./forkShareSubmissionLock";

it("keeps startup submissions locked until the inbox is known, then locks only recovered targets", async () => {
  try {
    makeForkIncomingShareImports({
      registry: appAtomRegistry, getShare: () => null,
      reserve: async () => {}, release: async () => {}, consume: async () => {},
      readDraft: () => ({text: "", attachments: []}),
      undoMerge: async () => {}, mergeIntoDraft: async () => ({skippedAttachmentCount: 0}),
      selectAttachments: () => ({status: "ready", attachments: [], warnings: []}),
      releaseUnusedAttachments: () => {}, onWarnings: () => {}, onImportFailure: () => {}, onCancelFailure: () => {}, leave: () => {},
    });
    expect(isForkShareSubmissionLocked("env:thread")).toBe(true);
    presentForkShareDestinations([], true);
    expect(isForkShareSubmissionLocked("env:thread")).toBe(true);
    // A failed inbox read retains the same unknown snapshot for navigation events.
    presentForkShareDestinations([], true);
    expect(isForkShareSubmissionLocked("env:thread")).toBe(true);
    presentForkShareDestinations([{schemaVersion: 1, id: "recovered", createdAt: "2026-10-29", text: "shared", attachments: [], warnings: [], destination: {environmentId: "env", projectId: "project", threadId: "thread"}}], false);
    expect(isForkShareSubmissionLocked("env:thread")).toBe(true);
    expect(isForkShareSubmissionLocked("env:other")).toBe(false);
    await forkShareDestinations?.prepared();
  } finally {appAtomRegistry.dispose();}
});
