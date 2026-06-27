import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { TimeClient, TimeProject, TimeTask } from "../../api/types";

const NO_CLIENTS: TimeClient[] = [];
const NO_PROJECTS: TimeProject[] = [];
const NO_TASKS: TimeTask[] = [];

/**
 * Timesheet catalog (clients, projects, task types) that powers the dropdowns + the Settings tab.
 * All projects are fetched once and filtered by client in-memory (`projectsFor`). Mutations invalidate
 * the whole catalog key. Archived rows are kept for editing but `*Active` lists hide them from pickers.
 */
export function useTimeCatalog() {
  const qc = useQueryClient();
  const clientsQ = useQuery({ queryKey: ["time", "catalog", "clients"], queryFn: api.time.clients });
  const projectsQ = useQuery({ queryKey: ["time", "catalog", "projects"], queryFn: () => api.time.projects() });
  const tasksQ = useQuery({ queryKey: ["time", "catalog", "tasks"], queryFn: api.time.tasks });

  const clients = clientsQ.data?.clients ?? NO_CLIENTS;
  const projects = projectsQ.data?.projects ?? NO_PROJECTS;
  const tasks = tasksQ.data?.tasks ?? NO_TASKS;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["time", "catalog"] });

  return {
    clients, projects, tasks,
    clientsActive: clients.filter((c) => !c.archived),
    tasksActive: tasks.filter((t) => !t.archived),
    projectsFor: (clientId: string | null) => projects.filter((p) => p.clientId === clientId && !p.archived),

    addClient: async (name: string) => { const r = await api.time.createClient(name); invalidate(); return r.client; },
    renameClient: async (id: string, name: string) => { await api.time.updateClient(id, { name }); invalidate(); },
    archiveClient: async (id: string, archived: boolean) => { await api.time.updateClient(id, { archived }); invalidate(); },
    removeClient: async (id: string) => { await api.time.removeClient(id); invalidate(); },

    addProject: async (clientId: string, name: string) => { const r = await api.time.createProject(clientId, name); invalidate(); return r.project; },
    renameProject: async (id: string, name: string) => { await api.time.updateProject(id, { name }); invalidate(); },
    archiveProject: async (id: string, archived: boolean) => { await api.time.updateProject(id, { archived }); invalidate(); },
    removeProject: async (id: string) => { await api.time.removeProject(id); invalidate(); },

    addTask: async (name: string) => { const r = await api.time.createTask(name); invalidate(); return r.task; },
    renameTask: async (id: string, name: string) => { await api.time.updateTask(id, { name }); invalidate(); },
    archiveTask: async (id: string, archived: boolean) => { await api.time.updateTask(id, { archived }); invalidate(); },
    removeTask: async (id: string) => { await api.time.removeTask(id); invalidate(); },
  };
}

export type TimeCatalog = ReturnType<typeof useTimeCatalog>;
