import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

// Owner-only access-link data: the links + the live teammate roster (the presence socket invalidates
// ["accessKeys"] on every roster change, so this stays live without polling).
export function useAccessKeys() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["accessKeys"] });
  const query = useQuery({ queryKey: ["accessKeys"], queryFn: api.accessKeys.list });
  const create = useMutation({ mutationFn: api.accessKeys.create, onSuccess: invalidate });
  const revoke = useMutation({ mutationFn: api.accessKeys.revoke, onSuccess: invalidate });
  const kick = useMutation({ mutationFn: api.accessKeys.kick, onSuccess: invalidate });
  return {
    keys: query.data?.keys ?? [],
    sessions: query.data?.sessions ?? [],
    isLoading: query.isLoading,
    create, revoke, kick,
  };
}
