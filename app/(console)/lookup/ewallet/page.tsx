import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "E-wallet identity" };
export const dynamic = "force-dynamic";

export default function EwalletLookupPage() {
  return (
    <LookupConsole
      module="ewallet"
      icon="card"
      title="E-wallet identity"
      description="Verified wallet names across GoPay, OVO, DANA and ShopeePay when a provider is configured."
      placeholder="+62 812 3456 7890"
      examples={["+62 812 3456 7890", "+62 895 1234 5678"]}
      cost={costOf("ewallet")}
    />
  );
}
