import { Flag, Timer } from "lucide-react";
import type { TaskPriority } from "../../types";
import { cn } from "../../lib/classNames";

type TaskMetaBadgeProps = {
  type: "date" | "estimate" | "priority";
  label: string;
  priority?: TaskPriority;
};

export function TaskMetaBadge({ type, label, priority }: TaskMetaBadgeProps) {
  if (type === "estimate") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-surface-card px-xs py-1 text-caption text-muted dark:bg-surface-dark dark:text-on-dark-soft">
        <Timer size={14} />
        {label}
      </span>
    );
  }

  if (type === "priority") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-caption",
          priority === "high" && "text-badge-orange",
          priority === "medium" && "text-warning",
          priority === "low" && "text-muted",
        )}
      >
        <Flag size={14} />
        {label}
      </span>
    );
  }

  return <span className="text-caption font-semibold text-warning">{label}</span>;
}
