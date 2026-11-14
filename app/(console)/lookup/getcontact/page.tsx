import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Caller-ID tags" };
export const dynamic = "force-dynamic";

export default function GetContactLookupPage() {
  return (
    <LookupConsole
      module="getcontact"
      icon="users"
      title="Caller-ID tags"
      description="Name tags attached to a number by caller-ID providers, clustered for near-duplicate spellings."
      placeholder="+62 812 3456 7890"
      examples={["+62 812 3456 7890", "+62 813 9876 5432"]}
      cost={costOf("getcontact")}
    />
  );
}
