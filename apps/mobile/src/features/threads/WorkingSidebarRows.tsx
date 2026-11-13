import type { ComponentProps } from "react";
import { View } from "react-native";
import { ThreadListV2Row, ThreadListV2WorkingShelfHeader } from "./thread-list-v2-items";

function Divider({ pane }: { readonly pane?: "screen" | "sidebar" }) {
  return (
    <View
      className={
        pane === "sidebar"
          ? "mx-3 mt-3 h-px bg-drawer-border"
          : "mx-5 mt-3 h-px bg-border"
      }
    />
  );
}

export function WorkingSidebarRow({
  workingDivider,
  ...props
}: ComponentProps<typeof ThreadListV2Row> & { readonly workingDivider: boolean }) {
  if (!workingDivider) return <ThreadListV2Row {...props} />;
  return (
    <View>
      <Divider pane={props.pane} />
      <ThreadListV2Row {...props} />
    </View>
  );
}

export function WorkingSidebarHeader(props: ComponentProps<typeof ThreadListV2WorkingShelfHeader>) {
  return (
    <View>
      <Divider pane={props.pane} />
      <ThreadListV2WorkingShelfHeader {...props} />
    </View>
  );
}
