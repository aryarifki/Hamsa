import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "HUMINT records" };
export const dynamic = "force-dynamic";

export default function HumintLookupPage() {
  return (
    <LookupConsole
      module="humint"
      icon="folder"
      title="HUMINT records"
      description="Matches a number against your own harvester dumps — paste a JSON payload or set HAMSA_HUMINT_DIR."
      placeholder="+62 812 3456 7890"
      examples={["+62 812 3456 7890"]}
      keywordLabel="JSON dump (optional)"
      keywordPlaceholder='[{"phone":"+62812...","content":"..."}]'
      cost={costOf("humint")}
    />
  );
}
