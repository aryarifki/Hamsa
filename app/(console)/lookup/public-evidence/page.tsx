import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Public evidence" };
export const dynamic = "force-dynamic";

export default function PublicEvidenceLookupPage() {
  return (
    <LookupConsole
      module="public-evidence"
      icon="eye"
      title="Public evidence sweep"
      description="Social media, marketplaces, hosting and online media — probed, with login-gated platforms flagged."
      placeholder="+62 812 3456 7890  or  handle"
      examples={["+62 812 3456 7890", "aryarifki"]}
      cost={costOf("public-evidence")}
    />
  );
}
