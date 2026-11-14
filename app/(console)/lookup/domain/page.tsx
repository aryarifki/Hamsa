import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Domain intelligence" };
export const dynamic = "force-dynamic";

export default function DomainLookupPage() {
  return (
    <LookupConsole
      module="domain"
      icon="globe"
      title="Domain intelligence"
      description="RDAP registration, live DNS over HTTPS and certificate-transparency subdomains."
      placeholder="example.co.id"
      examples={["example.co.id", "kominfo.go.id"]}
      cost={costOf("domain")}
    />
  );
}
