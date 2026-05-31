import { CalendarDays, CheckCircle2, History, ListTodo } from "lucide-react";
import type { SmartView, Task } from "../../types";
import { cn } from "../../lib/classNames";

type SmartFilterNavProps = {
  activeView: SmartView | null;
  tasks: Task[];
  onSelect: (view: SmartView) => void;
};

const filters = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "tomorrow", label: "Tomorrow", icon: CalendarDays },
  { id: "past", label: "Past", icon: History },
  { id: "all", label: "All", icon: CheckCircle2 },
] satisfies Array<{ id: SmartView; label: string; icon: typeof ListTodo }>;

export function SmartFilterNav({ activeView, tasks, onSelect }: SmartFilterNavProps) {
  const countFor = (view: SmartView) => {
    if (view === "all") {
      return tasks.reduce((total, task) => total + 1 + task.subtasks.length, 0);
    }
    return tasks.filter((task) => task.dueLabel === view).length;
  };

  return (
    <nav className="space-y-xxs" aria-label="智能筛选">
      {filters.map((filter) => {
        const Icon = filter.icon;
        const active = activeView === filter.id;
        return (
          <button
            key={filter.id}
            className={cn(
              "flex min-h-11 w-full items-center gap-sm rounded px-sm text-left transition-colors",
              active
                ? "bg-surface-variant font-semibold text-primary dark:bg-surface-dark-elevated dark:text-on-dark"
                : "text-muted hover:bg-surface-soft hover:text-ink dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark",
            )}
            onClick={() => onSelect(filter.id)}
          >
            <Icon size={20} />
            <span className="flex-1">{filter.label}</span>
            <span className="rounded-full px-xs text-caption text-muted dark:text-on-dark-soft">
              {countFor(filter.id)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
