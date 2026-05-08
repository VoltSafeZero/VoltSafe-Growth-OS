import { useQuery } from "@tanstack/react-query";

export type ColumnShare = {
  id: number;
  userId: number;
  userName: string;
  permission: "view" | "edit";
  sharedByUserId: number;
  sharedByName: string;
};

export type TaskColumn = {
  value: string;
  label: string;
  color: string;
  isSystem?: boolean;
  isOwn?: boolean;
  ownerId?: number;
  shares?: ColumnShare[];
};

// The 4 permanent system columns — always present for every user in this order
export const DEFAULT_TASK_COLUMNS: TaskColumn[] = [
  { value: "blocked",     label: "BLOCKERS",             color: "amber",  isSystem: true },
  { value: "delegated",   label: "DELEGATED (To Others)", color: "violet", isSystem: true },
  { value: "backlog",     label: "Backlog",               color: "slate",  isSystem: true },
  { value: "today_tasks", label: "Today's Tasks",         color: "teal",   isSystem: true },
];

export const COLUMN_COLOR_OPTIONS = [
  "slate","blue","violet","amber","emerald","rose","teal","red","orange","cyan","pink","lime",
] as const;

const BORDER_CLASS: Record<string, string> = {
  slate:   "border-slate-300 dark:border-slate-700",
  blue:    "border-blue-300 dark:border-blue-800",
  violet:  "border-violet-300 dark:border-violet-800",
  amber:   "border-amber-300 dark:border-amber-800",
  emerald: "border-emerald-300 dark:border-emerald-800",
  rose:    "border-rose-300 dark:border-rose-800",
  teal:    "border-teal-300 dark:border-teal-800",
  red:     "border-red-300 dark:border-red-800",
  orange:  "border-orange-300 dark:border-orange-800",
  cyan:    "border-cyan-300 dark:border-cyan-800",
  pink:    "border-pink-300 dark:border-pink-800",
  lime:    "border-lime-300 dark:border-lime-800",
};

const SWATCH_CLASS: Record<string, string> = {
  slate: "bg-slate-400", blue: "bg-blue-500", violet: "bg-violet-500",
  amber: "bg-amber-500", emerald: "bg-emerald-500", rose: "bg-rose-500",
  teal: "bg-teal-500", red: "bg-red-500", orange: "bg-orange-500",
  cyan: "bg-cyan-500", pink: "bg-pink-500", lime: "bg-lime-500",
};

export function columnBorderClass(color: string): string {
  return BORDER_CLASS[color] || BORDER_CLASS.slate;
}

export function columnSwatchClass(color: string): string {
  return SWATCH_CLASS[color] || SWATCH_CLASS.slate;
}

export function useTaskColumns() {
  const q = useQuery<TaskColumn[]>({
    queryKey: ["/api/task-columns"],
    staleTime: 30_000,
  });
  const columns = q.data && q.data.length > 0 ? q.data : DEFAULT_TASK_COLUMNS;
  return { columns, isLoading: q.isLoading };
}
