import { useQuery } from "@tanstack/preact-query";
import { supabase } from "../../shared/supabase/client";
import { pages } from "../../shared/supabase/pages";
export function useMembers(uid: string | undefined) {
  return useQuery({
    queryKey: ["members", uid],
    enabled: !!uid,
    queryFn: () =>
      pages((from, to) =>
        supabase.from("trip_members").select("*").order("id").range(from, to),
      ),
  });
}
