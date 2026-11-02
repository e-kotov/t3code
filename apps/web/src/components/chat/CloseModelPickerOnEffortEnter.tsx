import type { ReactNode } from "react";

export function CloseModelPickerOnEffortEnter({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="contents"
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.key !== "Enter" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !(target instanceof Element) ||
          !target.matches("[data-effort-level]:not(:disabled)")
        ) {
          return;
        }

        window.requestAnimationFrame(onClose);
      }}
    >
      {children}
    </div>
  );
}

export function closeModelPickerOnEffortEnter(props: {
  effortColumn?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return {
    effortColumn:
      props.effortColumn === undefined ? undefined : (
        <CloseModelPickerOnEffortEnter onClose={() => props.onOpenChange?.(false)}>
          {props.effortColumn}
        </CloseModelPickerOnEffortEnter>
      ),
  };
}
