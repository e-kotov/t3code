import type { File as FileInstance, PostRenderPhase, SelectedLineRange } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState, type ComponentProps } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { useClientSettings } from "~/hooks/useSettings";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { buildFileReviewComment } from "~/reviewCommentContext";

import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import {
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
} from "./fileCommentAnnotations";
import { FILE_LINK_REVEAL_UNSAFE_CSS } from "./fileSurfaceChrome";
import { useForkFileReviewComments } from "./ForkEditableFileComments";
import {
  FORK_SOURCE_SUBLINE_UNSAFE_CSS,
  buildSublineFileReviewComment,
  clearShadowSourceSublineHighlights,
  formatQuotedRangeLabel,
  type SourceSelection,
  syncShadowSourceSublineHighlights,
} from "./forkFileSublineComments";
import { ForkSourceSelectionToolbar, ForkSublineQuoteBadge } from "./ForkSourceSelectionToolbar";
import ReadOnlySourcePreview from "./ReadOnlySourcePreview";

interface CommentTarget {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

type Props = Omit<ComponentProps<typeof ReadOnlySourcePreview>, "onPostRender"> & {
  onPostRender?: <LAnnotation>(
    fileContainer: HTMLElement,
    instance: FileInstance<LAnnotation, undefined>,
    phase: PostRenderPhase,
  ) => void;
  commentTarget?: CommentTarget | undefined;
};

export default function CommentableSourcePreview({ commentTarget, ...props }: Props) {
  if (!commentTarget) return <ReadOnlySourcePreview {...props} />;
  return (
    <CommentableSource
      key={JSON.stringify([commentTarget, props.name, props.text])}
      {...props}
      commentTarget={commentTarget}
    />
  );
}

function CommentableSource({ commentTarget, ...props }: Props & { commentTarget: CommentTarget }) {
  const { environmentId, projectId, composerDraftTarget } = commentTarget;
  const resolvedTheme = useRenderedAppearance();
  const defaultWordWrap = useClientSettings((settings) => settings.wordWrap);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const fileComments = useForkFileReviewComments(composerDraftTarget, props.name, props.text);
  const [surfaceEl, setSurfaceEl] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{
    id: string;
    startLine: number;
    endLine: number;
    selection?: SourceSelection | undefined;
  } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const surfaceKey = JSON.stringify(["read-only-source", commentTarget, props.name]);
  const annotations: FileCommentLineAnnotation[] = [];
  for (const comment of fileComments) {
    let annotation = annotations.find((entry) => entry.lineNumber === comment.endIndex + 1);
    if (!annotation) {
      annotation = { lineNumber: comment.endIndex + 1, metadata: { entries: [] } };
      annotations.push(annotation);
    }
    annotation.metadata.entries.push({
      id: comment.id,
      kind: "comment",
      startLine: comment.startIndex + 1,
      endLine: comment.endIndex + 1,
      text: comment.text,
    });
  }
  if (draft) {
    const annotation = annotations.find((entry) => entry.lineNumber === draft.endLine);
    const entry = {
      id: draft.id,
      startLine: draft.startLine,
      endLine: draft.endLine,
      kind: "draft" as const,
      text: "",
    };
    if (annotation) annotation.metadata.entries.push(entry);
    else annotations.push({ lineNumber: draft.endLine, metadata: { entries: [entry] } });
  }
  const draftSelection = draft?.selection ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs CSS Highlights in the diffs shadow DOM for saved and draft subline comments
  useEffect(() => {
    const shadowRoot = surfaceEl?.querySelector("diffs-container")?.shadowRoot;
    syncShadowSourceSublineHighlights({
      surfaceKey,
      shadowRoot,
      contents: props.text,
      comments: fileComments,
      draft: draftSelection,
    });
    return () => clearShadowSourceSublineHighlights(surfaceKey);
  }, [draftSelection, fileComments, props.text, surfaceEl, surfaceKey]);

  const dismiss = () => {
    setDraft(null);
    setDraftText("");
    setSelectedLines(null);
  };
  const beginComment = (range: SelectedLineRange | null) => {
    if (!range) return;
    setSelectedLines(range);
    setDraftText("");
    setDraft({ id: nextFileCommentId(), ...normalizeFileCommentRange(range) });
  };
  const beginQuoteComment = (selection: SourceSelection) => {
    setSelectedLines(null);
    setDraftText("");
    setDraft({
      id: nextFileCommentId(),
      startLine: selection.startLine,
      endLine: selection.endLine,
      selection,
    });
  };
  return (
    <DiffWorkerPoolProvider>
      <div ref={setSurfaceEl} className="contents">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: props.name,
              contents: props.text,
              ...(props.cacheKey ? { cacheKey: props.cacheKey } : {}),
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: draft === null,
              enableLineSelection: draft === null,
              onGutterUtilityClick: setSelectedLines,
              onLineSelectionChange: setSelectedLines,
              onLineSelectionEnd: beginComment,
              overflow: (props.wordWrap ?? defaultWordWrap) ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: `${FILE_LINK_REVEAL_UNSAFE_CSS}\n${FORK_SOURCE_SUBLINE_UNSAFE_CSS}`,
              onPostRender: (fileContainer, instance, phase) => {
                if (phase !== "unmount") {
                  syncShadowSourceSublineHighlights({
                    surfaceKey,
                    shadowRoot: fileContainer.shadowRoot,
                    contents: props.text,
                    comments: fileComments,
                    draft: draftSelection,
                  });
                }
                props.onPostRender?.(fileContainer, instance, phase);
              },
            }}
            selectedLines={selectedLines}
            lineAnnotations={annotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => {
                  const entryQuote =
                    entry.kind === "draft"
                      ? draft?.selection?.quote
                      : fileComments.find((comment) => comment.id === entry.id)?.quote;
                  return (
                    <div key={entry.id}>
                      {entryQuote ? <ForkSublineQuoteBadge text={entryQuote.text} /> : null}
                      <DiffCommentAnnotation
                        environmentId={environmentId}
                        projectId={projectId}
                        ownerKey={JSON.stringify([commentTarget, props.name, entry.id])}
                        kind={entry.kind}
                        rangeLabel={
                          entryQuote
                            ? formatQuotedRangeLabel({
                                startLine: entry.startLine,
                                endLine: entry.endLine,
                                quoteText: entryQuote.text,
                              })
                            : formatFileCommentRange(entry.startLine, entry.endLine)
                        }
                        text={entry.kind === "draft" ? draftText : entry.text}
                        onTextChange={setDraftText}
                        onCancel={dismiss}
                        onComment={(text) => {
                          addReviewComment(
                            composerDraftTarget,
                            entryQuote
                              ? buildSublineFileReviewComment({
                                  id: entry.id,
                                  filePath: props.name,
                                  sectionKind: "file",
                                  text,
                                  quote: entryQuote,
                                  contents: props.text,
                                  startLine: entry.startLine,
                                  endLine: entry.endLine,
                                  selection: draft?.selection,
                                })
                              : buildFileReviewComment({
                                  id: entry.id,
                                  filePath: props.name,
                                  startLine: entry.startLine,
                                  endLine: entry.endLine,
                                  text,
                                  contents: props.text,
                                }),
                          );
                          dismiss();
                        }}
                        onDelete={() => removeReviewComment(composerDraftTarget, entry.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            className="min-h-full"
          />
        </Virtualizer>
        <ForkSourceSelectionToolbar
          surfaceEl={surfaceEl}
          contents={props.text}
          disabled={draft !== null}
          onComment={beginQuoteComment}
        />
      </div>
    </DiffWorkerPoolProvider>
  );
}
