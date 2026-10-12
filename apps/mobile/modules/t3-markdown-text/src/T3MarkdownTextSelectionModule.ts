import { requireOptionalNativeModule } from "expo";

interface T3MarkdownTextSelectionNativeModule {
  readonly setSelectionHandleColor?: (reactTag: number, color: number) => void;
  readonly installCopySanitizer: (
    reactTag: number,
    contextClipboardConfig: string,
    citationSourceConfig?: string,
  ) => void;
  addListener?: (
    event: "onCiteSelection",
    listener: (event: AssistantCitationSelectionEvent) => void,
  ) => { remove(): void };
  readonly renderContextChip?: (payloadJson: string) => {
    readonly uri: string;
    readonly width: number;
    readonly height: number;
    /** Inline box height: the paragraph font's ascent, so the line box never grows. */
    readonly boxHeight: number;
    /** Bitmap top relative to the box top; negative when the chip overhangs the box. */
    readonly offsetY: number;
  } | null;
}

export interface AssistantCitationSelectionEvent {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
  readonly suffix: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly messageId: string;
}

const nativeModule =
  requireOptionalNativeModule<T3MarkdownTextSelectionNativeModule>("T3MarkdownTextSelection");

export function installMarkdownCopySanitizer(
  reactTag: number,
  contextClipboardConfig = "",
  citationSourceConfig = "",
): void {
  nativeModule?.installCopySanitizer(reactTag, contextClipboardConfig, citationSourceConfig);
}

export function addAssistantCitationSelectionListener(
  listener: (event: AssistantCitationSelectionEvent) => void,
): { remove(): void } | null {
  return nativeModule?.addListener?.("onCiteSelection", listener) ?? null;
}

export function setMarkdownSelectionHandleColor(reactTag: number, color: number): void {
  nativeModule?.setSelectionHandleColor?.(reactTag, color);
}

export function renderAndroidContextChip(payloadJson: string) {
  return nativeModule?.renderContextChip?.(payloadJson) ?? null;
}
