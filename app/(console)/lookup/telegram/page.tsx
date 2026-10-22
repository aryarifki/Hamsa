import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Telegram public channels" };
export const dynamic = "force-dynamic";

export default function TelegramLookupPage() {
  return (
    <LookupConsole
      module="telegram"
      icon="send"
      title="Telegram public channels"
      description="Read-only search across a public channel's web preview. No account, no token, no private groups."
      placeholder="channelname"
      examples={["durov", "telegram"]}
      cost={costOf("telegram")}
      keywordLabel="Keyword"
      keywordPlaceholder="optional filter"
    />
  );
}
