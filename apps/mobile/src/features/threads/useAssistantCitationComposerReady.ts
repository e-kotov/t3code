import { Platform } from "react-native";
import { assistantCitationComposerReady } from "../../lib/assistantCitationDraft";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";

export function useAssistantCitationComposerReady(
  props: Parameters<typeof assistantCitationComposerReady>[0],
  state: Pick<Parameters<typeof assistantCitationComposerReady>[1], "isProviderSubagent" | "composerSlotHidden">,
) {
  const voiceInput = useGlobalVoiceInput();
  return assistantCitationComposerReady(props, { ...state, platform: Platform.OS, voiceInput });
}
