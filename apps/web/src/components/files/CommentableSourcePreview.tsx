import type { SelectedLineRange } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useState, type ComponentProps } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { useClientSettings } from "~/hooks/useSettings";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import {
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
} from "./fileCommentAnnotations";
import { FILE_LINK_REVEAL_UNSAFE_CSS } from "./fileSurfaceChrome";
import ReadOnlySourcePreview from "./ReadOnlySourcePreview";

interface CommentTarget {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

type Props = ComponentProps<typeof ReadOnlySourcePreview> & {
  commentTarget?: CommentTarget | undefined;
};
const EMPTY_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

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
  const comments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_COMMENTS,
  );
  const [draft, setDraft] = useState<{ id: string; startLine: number; endLine: number } | null>(null);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const annotations: FileCommentLineAnnotation[] = [];
  const lines = props.text.split("\n");
  for (const comment of comments) {
    if (comment.sectionId !== `file:${props.name}`) continue;
    // A refreshed file must not display an old comment against different text.
    if (lines.slice(comment.startIndex, comment.endIndex + 1).join("\n") !== comment.diff) continue;
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
    const entry = { ...draft, kind: "draft" as const, text: "" };
    if (annotation) annotation.metadata.entries.push(entry);
    else annotations.push({ lineNumber: draft.endLine, metadata: { entries: [entry] } });
  }
  const dismiss = () => {
    setDraft(null);
    setSelectedLines(null);
  };
  const beginComment = (range: SelectedLineRange | null) => {
    if (!range) return;
    setSelectedLines(range);
    setDraft({ id: nextFileCommentId(), ...normalizeFileCommentRange(range) });
  };
  return (
    <DiffWorkerPoolProvider>
      <Virtualizer
        className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        <File<FileCommentAnnotationGroup>
          file={{ name: props.name, contents: props.text, ...(props.cacheKey ? { cacheKey: props.cacheKey } : {}) }}
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
            unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
            ...(props.onPostRender ? { onPostRender: props.onPostRender } : {}),
          }}
          selectedLines={selectedLines}
          lineAnnotations={annotations}
          renderAnnotation={(annotation) => (
            <div className="py-1">
              {annotation.metadata.entries.map((entry) => (
                <DiffCommentAnnotation
                  key={entry.id}
                  environmentId={environmentId}
                  projectId={projectId}
                  ownerKey={JSON.stringify([commentTarget, props.name, entry.id])}
                  kind={entry.kind}
                  rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                  text={entry.text}
                  onCancel={dismiss}
                  onComment={(text) => {
                    addReviewComment(composerDraftTarget, buildFileReviewComment({
                      id: entry.id,
                      filePath: props.name,
                      startLine: entry.startLine,
                      endLine: entry.endLine,
                      text,
                      contents: props.text,
                    }));
                    dismiss();
                  }}
                  onDelete={() => removeReviewComment(composerDraftTarget, entry.id)}
                />
              ))}
            </div>
          )}
          className="min-h-full"
        />
      </Virtualizer>
    </DiffWorkerPoolProvider>
  );
}
