import type { VerticalHinge } from "../../lib/layout";

export function utilitiesLayout(
  width: number,
  fontScale: number,
  insets: { readonly left: number; readonly right: number },
  hinge: VerticalHinge | null,
) {
  let left = insets.left;
  let right = insets.right;
  if (hinge && hinge.x >= left && hinge.x + hinge.width <= width - right) {
    const end = hinge.x + hinge.width;
    if (width - right - end >= hinge.x - left) left = end;
    else right = width - hinge.x;
  }
  return { left, right, wide: (width - left - right) / fontScale >= 840 };
}
