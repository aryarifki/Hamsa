import { requireUser } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/notify";
import { markNotificationsReadAction } from "@/app/(console)/actions";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const stamp = (iso: string) => new Date(iso).toLocaleString();

const tone = (kind: string): string => {
  if (kind.startsWith("camera.disabled")) return "badge-bad";
  if (kind === "geofence.enter") return "badge-good";
  if (kind === "geofence.exit") return "badge-brass";
  return "";
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const [notifications, unread] = await Promise.all([
    listNotifications(user.id, 100),
    unreadCount(user.id),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            Camera fail-closed alerts for administrators and geofence transitions for the device
            owner. Only the events relevant to your role are delivered here.
          </p>
        </div>
        {unread > 0 && (
          <form action={markNotificationsReadAction} className="ml-auto">
            <button type="submit" className="btn px-3 py-1.5 text-[12px]">
              <Icon name="check" size={12} /> Mark all read ({unread})
            </button>
          </form>
        )}
      </header>

      <div className="card overflow-hidden">
        {notifications.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Icon name="alert" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">Nothing yet.</p>
            <p className="mt-1 text-[11.5px] text-faint">
              A camera that locks itself after an authentication failure and any geofence entry or
              exit will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={`flex flex-wrap items-start gap-3 px-5 py-3.5 ${
                  notification.read_at ? "opacity-70" : ""
                }`}
              >
                <span className={`badge mt-0.5 ${tone(notification.kind)}`}>
                  {notification.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">{notification.title}</p>
                  {notification.body && (
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{notification.body}</p>
                  )}
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10.5px] text-faint">{stamp(notification.created_at)}</p>
                  {!notification.read_at && (
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-brass" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
