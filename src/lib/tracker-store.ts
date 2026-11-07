import { supabase } from "@/integrations/supabase/client";
import { isFinal, patchToRow, rowToSignal, signalToRow, type TrackedRow, type TrackedSignal } from "./signal-tracker";

/**
 * Tracked signals saved to the signed-in account (Lovable Cloud), with an in-memory copy for instant UI.
 * Signals tracked on this browser before accounts existed are moved into the account once.
 */
const LEGACY_KEY = "apex-tracked-signals-v1";
const EMPTY: TrackedSignal[] = [];
let items: TrackedSignal[] = EMPTY;
let userId: string | null = null;
let started = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const set = (next: TrackedSignal[]) => { items = next; emit(); };

async function importLegacy(uid: string, existing: TrackedSignal[]) {
  let legacy: TrackedSignal[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]") as unknown;
    legacy = Array.isArray(parsed) ? (parsed as TrackedSignal[]).filter((s) => s && typeof s.id === "string") : [];
  } catch { /* ignore broken data */ }
  const fresh = legacy.filter((s) => !existing.some((e) => e.id === s.id));
  if (fresh.length) {
    const { error } = await supabase.from("tracked_signals").upsert(fresh.map((s) => ({ ...signalToRow(s), user_id: uid })), { onConflict: "user_id,id", ignoreDuplicates: true });
    if (error) return existing;
  }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* blocked */ }
  return [...fresh, ...existing].sort((a, b) => b.trackedAt - a.trackedAt);
}

async function load(uid: string) {
  const { data, error } = await supabase.from("tracked_signals").select("*").eq("user_id", uid).order("tracked_at", { ascending: false });
  if (userId !== uid) return;
  if (error) { console.error("Could not load tracked signals", error); return; }
  const list = (data as TrackedRow[]).map(rowToSignal);
  const merged = await importLegacy(uid, list);
  if (userId === uid) set(merged);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user.id ?? null;
    if (uid === userId) return;
    userId = uid;
    set(EMPTY);
    if (uid) setTimeout(() => void load(uid), 0); // never await inside the auth callback
  });
}

export const trackerStore = {
  subscribe(l: () => void) {
    start();
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  get: () => items,
  getServer: () => EMPTY,
  has: (id: string) => items.some((s) => s.id === id),
  async add(s: Omit<TrackedSignal, "status" | "target" | "closedAt" | "checkedAt" | "trackedAt">) {
    const uid = userId;
    if (!uid || items.some((x) => x.id === s.id)) return;
    const full: TrackedSignal = { ...s, trackedAt: Date.now(), status: "OPEN", target: null, closedAt: null, checkedAt: null };
    set([full, ...items]);
    const { error } = await supabase.from("tracked_signals").insert({ ...signalToRow(full), user_id: uid });
    if (error) { console.error("Could not save tracked signal", error); set(items.filter((x) => x.id !== s.id)); throw error; }
  },
  async update(id: string, patch: Partial<TrackedSignal>) {
    const uid = userId;
    if (!uid) return;
    set(items.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("tracked_signals").update(patchToRow(patch)).eq("user_id", uid).eq("id", id);
    if (error) console.error("Could not update tracked signal", error);
  },
  async remove(id: string) {
    const uid = userId;
    if (!uid) return;
    const before = items;
    set(items.filter((s) => s.id !== id));
    const { error } = await supabase.from("tracked_signals").delete().eq("user_id", uid).eq("id", id);
    if (error) { console.error("Could not remove tracked signal", error); set(before); }
  },
  async clearFinished() {
    const uid = userId;
    if (!uid) return;
    const before = items;
    const done = items.filter(isFinal).map((s) => s.id);
    if (!done.length) return;
    set(items.filter((s) => !isFinal(s)));
    const { error } = await supabase.from("tracked_signals").delete().eq("user_id", uid).in("id", done);
    if (error) { console.error("Could not clear tracked signals", error); set(before); }
  },
};
