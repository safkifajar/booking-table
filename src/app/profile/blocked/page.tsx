import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getBlockedList } from "@/lib/friend-actions";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { BlockedManager } from "./BlockedManager";

/** Daftar user yang KAMU blokir + buka blokir. (PRD Friends K6) */
export default async function ProfileBlockedPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/blocked");
  }
  const blocked = await getBlockedList();

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Blocked Users" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <BlockedManager blocked={blocked} />
      </div>
    </main>
  );
}
