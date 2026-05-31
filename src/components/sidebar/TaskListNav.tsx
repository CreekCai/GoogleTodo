import type { Task, TaskListSummary } from "../../types";
import { cn } from "../../lib/classNames";

type TaskListNavProps = {
  lists: TaskListSummary[];
  tasks: Task[];
  activeListId: string;
  activeSmartView: string | null;
  onSelect: (listId: string) => void;
};

export function TaskListNav({
  lists,
  tasks,
  activeListId,
  activeSmartView,
  onSelect,
}: TaskListNavProps) {
  const countFor = (listId: string) =>
    tasks
      .filter((task) => task.listId === listId)
      .reduce((total, task) => total + 1 + task.subtasks.length, 0);

  return (
    <div>
      <div className="mb-xs px-sm text-caption font-semibold uppercase text-muted dark:text-on-dark-soft">
        Lists
      </div>
      <nav className="space-y-xxs" aria-label="任务列表">
        {lists.map((list) => {
          const Icon = list.icon;
          const active = !activeSmartView && activeListId === list.id;
          return (
            <button
              key={list.id}
              className={cn(
                "flex min-h-11 w-full items-center gap-sm rounded px-sm text-left transition-colors",
                active
                  ? "bg-surface-variant font-semibold text-primary dark:bg-surface-dark-elevated dark:text-on-dark"
                  : "text-muted hover:bg-surface-soft hover:text-ink dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark",
              )}
              onClick={() => onSelect(list.id)}
            >
              <Icon className={list.iconClassName} size={20} />
              <span className="flex-1">{list.name}</span>
              <span className="text-caption text-muted dark:text-on-dark-soft">{countFor(list.id)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
