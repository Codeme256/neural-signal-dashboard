import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarSrc, useProfile, useSaveProfile, type Profile } from "@/lib/profile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function UserAvatar({ profile, className }: { profile: Profile | null | undefined; className?: string }) {
  const src = useAvatarSrc(profile?.avatarUrl);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-primary/20 font-display font-bold text-primary">{initials(profile?.displayName ?? "")}</AvatarFallback>
    </Avatar>
  );
}

export function UserMenu() {
  const { data: profile } = useProfile();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error("Could not sign out. Please try again."); return; }
    await qc.cancelQueries();
    qc.clear();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-3 backdrop-blur hover:border-primary" aria-label="Account menu">
          <UserAvatar profile={profile} className="h-8 w-8" />
          <span className="hidden max-w-28 truncate font-mono text-xs sm:inline">{profile?.displayName ?? "…"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="truncate font-display">{profile?.displayName}</div>
            <div className="truncate font-mono text-[10px] font-normal text-muted-foreground">{profile?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/analysis" })}>My tracked signals</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {profile && <ProfileDialog key={String(editing)} open={editing} profile={profile} onClose={() => setEditing(false)} />}
    </>
  );
}

function ProfileDialog({ open, profile, onClose }: { open: boolean; profile: Profile; onClose: () => void }) {
  const save = useSaveProfile();
  const [name, setName] = useState(profile.displayName);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const [busy, setBusy] = useState(false);
  const current = useAvatarSrc(profile.avatarUrl);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type)) { toast.error("Choose a JPG, PNG, WebP, or GIF picture."); return; }
    if (f.size > 2 * 1024 * 1024) { toast.error("Picture must be smaller than 2 MB."); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Please enter a name."); return; }
    setBusy(true);
    try {
      await save(profile.id, { displayName: name, file });
      toast.success("Profile saved");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? current;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="signal-panel max-w-sm border-primary/40">
        <DialogTitle className="font-display text-xl font-bold">Edit profile</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Your name and picture show at the top of the site.</DialogDescription>
        <form onSubmit={submit} className="mt-2 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {shown && <AvatarImage src={shown} alt="" referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-primary/20 font-display text-lg font-bold text-primary">{initials(name)}</AvatarFallback>
            </Avatar>
            <label className="chip cursor-pointer">
              CHANGE PICTURE
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] tracking-widest text-muted-foreground">NAME</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm outline-none focus:border-primary" />
          </label>
          <button type="submit" disabled={busy} className="scan-btn w-full">{busy ? "SAVING…" : "SAVE"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
