import type { ToolDef } from "../types.js";
import { noteTools } from "./notes.js";
import { boardTools } from "./board.js";
import { reminderTools } from "./reminders.js";
import { alertTools } from "./alerts.js";
import { canvasTools } from "./canvas.js";
import { terminalTools } from "./terminals.js";
import { scheduleTools } from "./schedule.js";
import { knowledgeTools } from "../knowledge/tools.js";

// The built-in 'core' skill's tools: app-control actions + product knowledge, always available while
// the copilot is on.
export const coreTools: ToolDef[] = [
  ...knowledgeTools,
  ...noteTools,
  ...boardTools,
  ...reminderTools,
  ...alertTools,
  ...canvasTools,
  ...terminalTools,
  ...scheduleTools,
];
