import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { RegisterForm } from "@/components/AuthForms";

export const metadata = { title: "Request access" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  return <RegisterForm />;
}
