import type { MenuAction } from "@react-native-menu/menu";

export function currentMenuParent(actions: readonly MenuAction[], path: readonly MenuAction[]) {
  let level = actions;
  let parent: MenuAction | null = null;
  for (const previous of path) {
    const current = level.find((action) => previous.id ? action.id === previous.id : action.title === previous.title);
    if (!current) return null;
    parent = current;
    level = current.subactions ?? [];
  }
  return parent;
}
