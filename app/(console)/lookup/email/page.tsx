import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Email intelligence" };
export const dynamic = "force-dynamic";

export default function EmailLookupPage() {
  return (
    <LookupConsole
      module="email"
      icon="mail"
      title="Email intelligence"
      description="Deliverability, MX posture, disposable and role-account detection, breach exposure."
      placeholder="analyst@example.com"
      examples={["analyst@example.com", "hello@github.com", "test@mailinator.com"]}
      cost={costOf("email")}
    />
  );
}
