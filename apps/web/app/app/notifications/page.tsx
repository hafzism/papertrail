import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { createClient } from "../../../src/lib/supabase/server";
import { MarkNotificationRead } from "./mark-notification-read";

export default async function NotificationsPage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/notifications");
  const [{ data: notifications, error }, { data: telegramDeliveries }] = await Promise.all([
    supabase.from("notifications").select("id, event_type, minimal_text, deep_link, actionable_status, read_at, created_at").order("created_at", { ascending: false }),
    supabase.from("telegram_notification_deliveries").select("notification_id, state, created_at").order("created_at", { ascending: false }),
  ]);
  const telegramDeliveryByNotification = new Map((telegramDeliveries ?? []).map((delivery) => [delivery.notification_id, delivery]));

  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--navy-dark)]" href="/app">Back to workspace</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Private updates</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">Notifications</h1>
    <p className="mt-4 max-w-2xl leading-7 text-[var(--slate)]">This inbox records private application and activity updates. A notification signals that review may be needed; it does not assert eligibility, an external action, or delivery through another channel.</p>
    {error ? <p className="mt-8 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Notifications could not be loaded. Refresh and try again.</p> : null}
    {!error && notifications?.length === 0 ? <p className="mt-8 text-[var(--slate)]">No private updates have been recorded yet.</p> : null}
    <ul className="mt-8 grid gap-3">
      {notifications?.map((notification) => <li className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm" key={notification.id}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{notification.read_at ? "Recorded update" : "Unread update"}</p>
          {notification.actionable_status ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">{notification.actionable_status.replaceAll("_", " ")}</span> : null}
        </div>
        <p className="mt-3 leading-7 text-[var(--slate)]">{notification.minimal_text}</p>
        <p className="mt-3 text-sm text-[var(--slate)]">{new Date(notification.created_at).toLocaleString()}</p>
        {telegramDeliveryByNotification.get(notification.id) ? <p className="mt-2 text-sm text-[var(--slate)]">Telegram delivery: {telegramDeliveryByNotification.get(notification.id)?.state.replaceAll("_", " ")}. This is delivery state only, not proof the message was read.</p> : null}
        {notification.deep_link?.startsWith("/") ? <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={notification.deep_link}>Open related record</a> : null}
        {notification.read_at === null ? <MarkNotificationRead notificationId={notification.id} /> : null}
      </li>)}
    </ul>
  </main>;
}
