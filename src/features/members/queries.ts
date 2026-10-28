import { useQuery } from "@tanstack/preact-query";
import { supabase } from "../../shared/supabase/client";
import { pages } from "../../shared/supabase/pages";
import { cacheTripData, readCachedTripData } from "../offline/db";
type MemberRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  display_name: string;
  role: string;
  status: string;
  managed_by_user_id: string | null;
};
function mayUseOfflineCache(error: unknown) {
  const candidate = error as { status?: number; code?: string } | null;
  return (
    candidate?.status !== 401 &&
    candidate?.status !== 403 &&
    candidate?.code !== "42501" &&
    candidate?.code !== "PGRST301" &&
    (!navigator.onLine || !candidate?.status || candidate.status >= 500)
  );
}
export function useMembers(uid: string | undefined) {
  return useQuery({
    queryKey: ["members", uid],
    enabled: !!uid,
    queryFn: async () => {
      try {
        const rows = await pages((from, to) =>
          supabase.from("trip_members").select("*").order("id").range(from, to),
        );
        if (uid) await cacheTripData(uid, "__dashboard__", "members", rows);
        return rows;
      } catch (error) {
        const cached =
          uid && mayUseOfflineCache(error)
            ? await readCachedTripData<MemberRow[]>(
                uid,
                "__dashboard__",
                "members",
              )
            : undefined;
        if (cached) return cached;
        throw error;
      }
    },
  });
}
