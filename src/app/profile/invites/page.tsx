import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getMyInvites } from "@/lib/actions";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { InvitesManager } from "./InvitesManager";

// Undangan berbasis waktu (reservasi) & status live → selalu dinamis.
export const dynamic = "force-dynamic";

/**
 * Halaman "Table Invites" (/profile/invites) — record undangan meja yang
 * DITERIMA user: siapa mengundang, kapan, status. Tab Pending (approve/decline),
 * Accepted, Declined/Cancelled (record). Data dari arsip session_invites.
 */
export default async function ProfileInvitesPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/invites");
  }

  const invites = await getMyInvites();

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Table Invites" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <InvitesManager invites={invites} />
      </div>
    </main>
  );
}
