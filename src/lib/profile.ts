import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Profile = { id: string; email: string | null; displayName: string; avatarUrl: string | null };

/** Uploaded pictures are stored privately as "storage:<path>"; Google pictures are plain https URLs. */
const STORAGE_PREFIX = "storage:";

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: async (): Promise<Profile | null> => {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return null;
    const { data } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();
    const meta = user.user_metadata as Record<string, string | undefined>;
    return {
      id: user.id,
      email: user.email ?? null,
      displayName: data?.display_name || meta['full_name'] || meta['name'] || user.email?.split("@")[0] || "Trader",
      avatarUrl: data?.avatar_url ?? meta['avatar_url'] ?? meta['picture'] ?? null,
    };
  },
  staleTime: 5 * 60_000,
});

export const useProfile = () => useQuery(profileQuery);

/** Turns a stored avatar value into an image URL the browser can show. */
export function useAvatarSrc(value: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setSrc(null); return; }
    if (!value.startsWith(STORAGE_PREFIX)) { setSrc(value); return; }
    let live = true;
    supabase.storage.from("avatars").createSignedUrl(value.slice(STORAGE_PREFIX.length), 60 * 60)
      .then(({ data, error }) => { if (live) setSrc(error ? null : data?.signedUrl ?? null); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [value]);
  return src;
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return async (userId: string, patch: { displayName?: string; file?: File | null }) => {
    const update: { id: string; display_name?: string; avatar_url?: string } = { id: userId };
    if (patch.displayName !== undefined) update.display_name = patch.displayName.trim().slice(0, 40);
    if (patch.file) {
      const ext = (patch.file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, patch.file, { upsert: true, contentType: patch.file.type });
      if (error) throw error;
      update.avatar_url = STORAGE_PREFIX + path;
    }
    const { error } = await supabase.from("profiles").upsert(update);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: profileQuery.queryKey });
  };
}
