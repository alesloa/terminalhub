import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CopilotSettings, CopilotReportMode, CopilotMcpTransport } from "../api/types";

// React-query access to the copilot's server state: the singleton settings + the conversation list.
// The live chat transcript streams over the WebSocket (see useCopilotSocket), not through here.
export function useCopilotSettings() {
  return useQuery({ queryKey: ["copilot", "settings"], queryFn: () => api.copilot.getSettings().then((r) => r.settings) });
}

export function usePatchCopilotSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CopilotSettings>) => api.copilot.patchSettings(patch),
    onSuccess: (r) => qc.setQueryData(["copilot", "settings"], r.settings),
  });
}

export function useCopilotConversations() {
  return useQuery({ queryKey: ["copilot", "conversations"], queryFn: () => api.copilot.listConversations().then((r) => r.conversations) });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.copilot.createConversation(title).then((r) => r.conversation),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "conversations"] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.copilot.deleteConversation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "conversations"] }),
  });
}

export function useCopilotSkills() {
  return useQuery({ queryKey: ["copilot", "skills"], queryFn: () => api.copilot.listSkills().then((r) => r.skills) });
}

export function usePatchSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { enabled?: boolean; settings?: Record<string, unknown> } }) => api.copilot.patchSkill(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "skills"] }),
  });
}

export function useSkillAccounts(skillId: string, enabled: boolean) {
  return useQuery({ queryKey: ["copilot", "accounts", skillId], queryFn: () => api.copilot.listAccounts(skillId).then((r) => r.accounts), enabled });
}

export function useCreateAccount(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { label: string; provider: string; config: Record<string, unknown>; secret: string }) => api.copilot.createAccount(skillId, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "accounts", skillId] }),
  });
}

export function useDeleteAccount(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aid: string) => api.copilot.deleteAccount(skillId, aid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "accounts", skillId] }),
  });
}

// ── Scheduled loops (jobs) ──
export function useSchedulableTools(enabled: boolean) {
  return useQuery({ queryKey: ["copilot", "tools"], queryFn: () => api.copilot.listTools().then((r) => r.tools), enabled });
}

export function useCopilotJobs() {
  return useQuery({ queryKey: ["copilot", "jobs"], queryFn: () => api.copilot.listJobs().then((r) => r.jobs) });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title?: string; tool: string; args?: Record<string, unknown>; intervalSec: number; reportMode?: CopilotReportMode }) => api.copilot.createJob(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "jobs"] }),
  });
}

export function usePatchJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { title?: string; args?: Record<string, unknown>; intervalSec?: number; reportMode?: CopilotReportMode; enabled?: boolean } }) => api.copilot.patchJob(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "jobs"] }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.copilot.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "jobs"] }),
  });
}

// MCP tool servers: list/import the user's connected servers and the global ones they can one-click add.
export function useMcpServers() {
  return useQuery({ queryKey: ["copilot", "mcp"], queryFn: () => api.copilot.listMcp().then((r) => r.servers) });
}

export function useImportableMcp(enabled: boolean) {
  return useQuery({ queryKey: ["copilot", "mcp", "importable"], queryFn: () => api.copilot.importableMcp().then((r) => r.servers), enabled });
}

export function useCreateMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { label: string; transport: CopilotMcpTransport; command: string[]; url?: string | null; env?: Record<string, string> }) => api.copilot.createMcp(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "mcp"] }),
  });
}

export function usePatchMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { label?: string; command?: string[]; url?: string | null; env?: Record<string, string>; enabled?: boolean } }) => api.copilot.patchMcp(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "mcp"] }),
  });
}

export function useRefreshMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.copilot.refreshMcp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "mcp"] }),
  });
}

export function useDeleteMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.copilot.deleteMcp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot", "mcp"] }),
  });
}
