// @effect-diagnostics nodeBuiltinImport:off - Codex owns this external SQLite database; open it read-only.
import { DatabaseSync } from "node:sqlite";

interface NativeThread {
  id: string;
  source: string;
  model_provider: string;
  created_at: number;
  updated_at: number;
  creator_account_id: string | null;
  attached_thread_parent_id: string | null;
}

export function readCodexTaskInventory(dbPath: string, threadId: string, accountId: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map((row) => row.name));
    const optional = ["creator_account_id", "attached_thread_parent_id"].map((name) =>
      columns.has(name) ? name : `NULL AS ${name}`,
    );
    const rows = db.prepare(`SELECT id, source, model_provider, created_at, updated_at, ${optional.join(",")} FROM threads`).all() as unknown as NativeThread[];
    const edges = db.prepare("SELECT child_thread_id, parent_thread_id FROM thread_spawn_edges").all();
    const parents = new Map<string, string>();
    const conflicting = new Set<string>();
    for (const row of rows) {
      try {
        const source = JSON.parse(row.source);
        const parent: unknown = source?.subagent?.thread_spawn?.parent_thread_id;
        if (typeof parent === "string") parents.set(row.id, parent);
      } catch { /* Native source strings such as appServer are not JSON. */ }
    }
    for (const row of edges) {
      const child = String(row.child_thread_id);
      const parent = String(row.parent_thread_id);
      if (parents.has(child) && parents.get(child) !== parent) conflicting.add(child);
      parents.set(child, parent);
    }
    const root = rows.find((row) => row.id === threadId);
    if (!root || root.attached_thread_parent_id || conflicting.has(threadId)) return null;
    const members = new Set([threadId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const [child, parent] of parents) {
        if (members.has(parent) && !members.has(child)) {
          members.add(child);
          changed = true;
        }
      }
      if (members.size > 1000) return null;
    }
    const family = rows.filter((row) => members.has(row.id));
    if (family.length !== members.size || family.some((row) =>
      row.model_provider !== "openai" || row.attached_thread_parent_id || conflicting.has(row.id) ||
      (row.creator_account_id !== null && row.creator_account_id !== accountId)
    )) return null;
    return {
      thread_id: threadId,
      created_at: new Date(root.created_at * 1000).toISOString(),
      descendant_thread_ids: [...members].filter((id) => id !== threadId).sort(),
      updatedAt: Math.max(...family.map((row) => row.updated_at)) * 1000,
    };
  } finally {
    db.close();
  }
}
