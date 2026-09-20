"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

export function MarkNotificationRead({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function markRead(): Promise<void> {
    setSaving(true);
    const { error } = await createClient().rpc("mark_notification_read", { p_notification_id: notificationId });
    setSaving(false);
    if (!error) router.refresh();
  }
  return <button className="mt-3 min-h-11 cursor-pointer rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} onClick={() => void markRead()} type="button">{saving ? "Recording…" : "Mark as read"}</button>;
}
