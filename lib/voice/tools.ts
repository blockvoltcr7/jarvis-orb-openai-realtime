import type { ToolDefinition } from "./types";

/**
 * Showcase tools — all run client-side, no API keys needed.
 * Add new tools here and they automatically appear in:
 *   - the OpenAI Realtime session.update tools array
 *   - the Mock provider's simulated tool list
 *   - the side panel
 */

const STORAGE_KEY = "jarvis.tasks";

function readTasks(): Array<{ id: string; title: string; due?: string; createdAt: number }> {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeTasks(tasks: ReturnType<typeof readTasks>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export const tools: ToolDefinition[] = [
  {
    name: "get_time",
    description:
      "Get the current date and time. Optionally provide a timezone like 'America/New_York' or 'Europe/London'.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name. Defaults to the user's local timezone.",
        },
      },
    },
    handler: ({ timezone }: { timezone?: string }) => {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long",
      });
      return {
        iso: now.toISOString(),
        formatted: formatter.format(now),
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },

  {
    name: "add_task",
    description: "Add a task to the user's local task list.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "What needs to be done." },
        due: { type: "string", description: "Optional ISO date string for the due date." },
      },
      required: ["title"],
    },
    handler: ({ title, due }: { title: string; due?: string }) => {
      const tasks = readTasks();
      const task = {
        id: Math.random().toString(36).slice(2),
        title,
        due,
        createdAt: Date.now(),
      };
      tasks.push(task);
      writeTasks(tasks);
      return { ok: true, task, totalTasks: tasks.length };
    },
  },

  {
    name: "list_tasks",
    description: "List all tasks the user has added.",
    parameters: { type: "object", properties: {} },
    handler: () => {
      const tasks = readTasks();
      return { count: tasks.length, tasks };
    },
  },

  {
    name: "clear_tasks",
    description: "Delete all tasks from the user's local task list.",
    parameters: { type: "object", properties: {} },
    handler: () => {
      const before = readTasks().length;
      writeTasks([]);
      return { ok: true, deleted: before };
    },
  },

  {
    name: "random_number",
    description: "Generate a random integer between min and max (inclusive).",
    parameters: {
      type: "object",
      properties: {
        min: { type: "number" },
        max: { type: "number" },
      },
      required: ["min", "max"],
    },
    handler: ({ min, max }: { min: number; max: number }) => {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return { value: Math.floor(Math.random() * (hi - lo + 1)) + lo };
    },
  },
];

/**
 * OpenAI Realtime session.update tool format.
 * `strict: true` enables strict JSON schema validation on the model side.
 * https://platform.openai.com/docs/guides/realtime-conversations
 */
export function toolsForSessionUpdate() {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: { ...t.parameters, strict: true },
  }));
}

export function findTool(name: string) {
  return tools.find((t) => t.name === name);
}
