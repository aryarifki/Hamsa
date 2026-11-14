import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Name lookup" };
export const dynamic = "force-dynamic";

export default function NameLookupPage() {
  return (
    <LookupConsole
      module="name"
      icon="users"
      title="Name lookup"
      description="Searches public indexes for a name plus an optional location, returning reviewable pointers."
      placeholder="Nama Lengkap"
      examples={["Budi Santoso"]}
      keywordLabel="Location (optional)"
      keywordPlaceholder="Jakarta"
      cost={costOf("name")}
    />
  );
}
