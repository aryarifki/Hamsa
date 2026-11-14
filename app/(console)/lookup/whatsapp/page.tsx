import { costOf } from "@/lib/tokens";
import { LookupConsole } from "@/components/LookupConsole";

export const metadata = { title: "WhatsApp check" };
export const dynamic = "force-dynamic";

export default function WhatsAppLookupPage() {
  return (
    <LookupConsole
      module="whatsapp"
      icon="send"
      title="WhatsApp registration"
      description="Checks whether a number resolves to a WhatsApp chat landing page, with an honest confidence label."
      placeholder="+62 812 3456 7890"
      examples={["+62 812 3456 7890", "+62 878 1234 5678"]}
      cost={costOf("whatsapp")}
    />
  );
}
