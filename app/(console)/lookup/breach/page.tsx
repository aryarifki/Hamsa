import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Breach exposure" };
export const dynamic = "force-dynamic";

export default function BreachLookupPage() {
  return (
    <LookupConsole
      module="breach"
      icon="alert"
      title="Breach exposure"
      description="Checks phone numbers against leak-check providers and email addresses against HIBP."
      placeholder="+62 812 3456 7890  or  analyst@example.com"
      examples={["+62 812 3456 7890", "test@example.com"]}
      cost={costOf("breach")}
    />
  );
}
