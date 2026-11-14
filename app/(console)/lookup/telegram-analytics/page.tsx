import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Telegram analytics" };
export const dynamic = "force-dynamic";

export default function TelegramAnalyticsPage() {
  return (
    <LookupConsole
      module="telegram-analytics"
      icon="send"
      title="Telegram analytics"
      description="Subscriber count, posting cadence, view distribution and engagement anomalies from the public preview."
      placeholder="@channel"
      examples={["@durov"]}
      cost={costOf("telegram-analytics")}
    />
  );
}
