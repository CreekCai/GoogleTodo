import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";

export type ResolvedThemeMode = "light" | "dark";

export type SmartView = "today" | "tomorrow" | "past" | "all";

export type WorkspaceTab = "list" | "board" | "calendar";

export type NoteColor = "default" | "amber" | "emerald" | "violet" | "cyan" | "rose";

export type TaskPriority = "low" | "medium" | "high";

export type TaskRecurrenceFrequency = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type TaskRecurrence = {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  endDate?: string;
};

export type TaskListSummary = {
  id: string;
  name: string;
  icon: ComponentType<LucideProps>;
  iconClassName: string;
};

export type Subtask = {
  id: string;
  title: string;
  completed: boolean;
};

export type Task = {
  id: string;
  listId: string;
  title: string;
  notes: string;
  reminderTime?: string;
  dueLabel?: SmartView;
  dueText?: string;
  estimate?: string;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  lastEdited: string;
  subtasks: Subtask[];
};

export type QuickTaskDraft = {
  title: string;
  listId: string;
  dueLabel: SmartView;
  estimate: string;
  notes: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  labels: string[];
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  reminderDate?: string;
  createdAt: string;
  lastEdited: string;
};
