import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "HLR lookup" };
export const dynamic = "force-dynamic";

export default function HlrLookupPage() {
  return (
    <LookupConsole
      module="hlr"
      icon="phone"
      title="HLR & carrier"
      description="Carrier, country, line type and attach state from numbering metadata plus an optional live provider."
      placeholder="+62 812 3456 7890"
      examples={["+62 812 3456 7890", "+62 857 1234 5678", "+1 415 555 0100"]}
      cost={costOf("hlr")}
    />
  );
}
