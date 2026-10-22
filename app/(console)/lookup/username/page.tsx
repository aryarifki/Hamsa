import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "Username intelligence" };
export const dynamic = "force-dynamic";

export default function UsernameLookupPage() {
  return (
    <LookupConsole
      module="username"
      icon="at"
      title="Username intelligence"
      description="Presence checks across a curated set of developer, social and publishing platforms."
      placeholder="handle  (without the @)"
      examples={["torvalds", "sindresorhus", "gaearon"]}
      cost={costOf("username")}
    />
  );
}
