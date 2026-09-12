import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/lib/roles";
import { currentUser } from "@/server/auth/session";

export default async function DashboardPage() {
  const user = await currentUser();
  redirect(user ? ROLE_HOME[user.role] : "/login");
}
