import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Phone intelligence" };
export const dynamic = "force-dynamic";

export default function PhoneLookupPage() {
  return (
    <LookupConsole
      module="phone"
      icon="phone"
      title="Phone intelligence"
      description="E.164 normalisation, carrier and line-type resolution, investigation pivots."
      placeholder="0812 3456 7890  or  +62 812 3456 7890"
      examples={["+62 812 3456 7890", "081234567890", "+1 415 555 0100", "+44 20 7946 0958"]}
      cost={costOf("phone")}
    />
  );
}
