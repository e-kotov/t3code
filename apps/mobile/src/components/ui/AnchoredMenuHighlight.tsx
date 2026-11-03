import { View } from "react-native";

/** Marks the row or button whose Android menu is open, as iOS context menus lift theirs. */
export function AnchoredMenuHighlight(props: {
  readonly frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}) {
  if (props.frame === null) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute rounded-[20px] border-2 border-primary/50 bg-primary/10"
      style={{
        left: props.frame.x,
        top: props.frame.y,
        width: props.frame.width,
        height: props.frame.height,
      }}
    />
  );
}
