import type { Project } from "./model";
export interface History {
  past: Project[];
  current: Project;
  future: Project[];
}
export type HistoryAction =
  | { type: "change"; project: Project }
  | { type: "reset"; project: Project }
  | { type: "undo" | "redo" };
export function historyReducer(h: History, a: HistoryAction): History {
  if (a.type === "reset") return { past: [], current: a.project, future: [] };
  if (a.type === "change")
    return JSON.stringify(h.current) === JSON.stringify(a.project)
      ? h
      : {
          past: [...h.past.slice(-49), h.current],
          current: a.project,
          future: [],
        };
  if (a.type === "undo" && h.past.length)
    return {
      past: h.past.slice(0, -1),
      current: h.past.at(-1)!,
      future: [h.current, ...h.future],
    };
  if (a.type === "redo" && h.future.length)
    return {
      past: [...h.past, h.current],
      current: h.future[0],
      future: h.future.slice(1),
    };
  return h;
}
