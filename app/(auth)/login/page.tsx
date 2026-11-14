import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginTabs } from "@/components/AuthForms";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <LoginTabs />;
}
