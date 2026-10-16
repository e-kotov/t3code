/** Semantic indicator colours adapt to the active product appearance. */
export function utilityColor(status: string, dark: boolean) {
  if (status === "healthy") return dark ? "#7cdaa1" : "#18723c";
  if (status === "down") return dark ? "#ff969c" : "#bb3038";
  if (status === "mixed" || status === "warning") return dark ? "#f3b269" : "#a85800";
  return dark ? "#afafaf" : "#656565";
}
