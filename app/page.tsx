import { auth } from "@/server/auth";
import { DashboardPage } from "@/app/_components/DashboardPage";
import { HomePage } from "@/app/_components/home/HomePage";

export default async function RootPage() {
  const session = await auth();
  if (!session) return <HomePage />;
  return <DashboardPage />;
}
