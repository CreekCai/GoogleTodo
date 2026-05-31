import type { Subtask } from "../../types";
import { CompletionToggle } from "./CompletionToggle";
import { cn } from "../../lib/classNames";

type SubtaskListProps = {
  subtasks: Subtask[];
  onToggleSubtask?: (subtaskId: string) => void;
  compact?: boolean;
};

export function SubtaskList({ subtasks, onToggleSubtask, compact = false }: SubtaskListProps) {
  if (subtasks.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "space-y-xs border-l-2 border-hairline dark:border-surface-tint",
        compact ? "ml-9 pl-md" : "pl-sm",
      )}
    >
      {subtasks.map((subtask) => (
        <div
          key={subtask.id}
          className={cn(
            "flex items-center gap-sm text-body-sm",
            subtask.completed
              ? "text-muted-soft line-through"
              : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark",
          )}
        >
          <CompletionToggle
            checked={subtask.completed}
            size="sm"
            onClick={() => onToggleSubtask?.(subtask.id)}
          />
          <span className="truncate">{subtask.title}</span>
        </div>
      ))}
    </div>
  );
}
