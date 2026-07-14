import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getMyFriendsList,
  getIncomingRequests,
  getOutgoingRequests,
} from "@/lib/friend-actions";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { FriendsManager } from "./FriendsManager";

/**
 * Halaman teman: daftar teman + tab Requests (masuk/keluar). (PRD Friends b, e)
 */
export default async function ProfileFriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/friends");
  }
  const { tab } = await searchParams;

  const [friends, incoming, outgoing] = await Promise.all([
    getMyFriendsList(),
    getIncomingRequests(),
    getOutgoingRequests(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Friends" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <FriendsManager
          friends={friends}
          incoming={incoming}
          outgoing={outgoing}
          initialTab={tab === "requests" ? "requests" : "friends"}
        />
      </div>
    </main>
  );
}
