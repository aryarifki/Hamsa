import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "IP intelligence" };
export const dynamic = "force-dynamic";

export default function IpLookupPage() {
  return (
    <LookupConsole
      module="ip"
      icon="globe"
      title="IP intelligence"
      description="Address classification, ASN attribution, geolocation and proxy signals."
      placeholder="8.8.8.8  ·  1.1.1.1  ·  2001:4860:4860::8888"
      examples={["8.8.8.8", "1.1.1.1", "103.21.244.0", "2001:4860:4860::8888"]}
      cost={costOf("ip")}
    />
  );
}
