import { SlidersHorizontal } from "lucide-react";
import type { ResolvedThemeMode } from "../../types";
import { Switch } from "../ui/Switch";

type TaskListHeaderProps = {
  title: string;
  subtitle: string;
  showCompleted: boolean;
  completedCount: number;
  theme: ResolvedThemeMode;
  onShowCompletedChange: (checked: boolean) => void;
};

export function TaskListHeader({
  title,
  subtitle,
  showCompleted,
  completedCount,
  theme,
  onShowCompletedChange,
}: TaskListHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-lg">
      <div>
        <h2 className="font-display text-display-sm text-ink dark:text-on-dark">{title}</h2>
        <p className="mt-1 text-body-sm text-muted dark:text-on-dark-soft">{subtitle}</p>
      </div>
      <div className="flex items-center gap-lg">
        <button className="inline-flex items-center gap-xs text-body-sm text-muted transition-colors hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark">
          <SlidersHorizontal size={18} />
          Filter
        </button>
        <Switch
          checked={showCompleted}
          onChange={onShowCompletedChange}
          label={`Show Completed (${completedCount})`}
          className={theme === "dark" ? "hidden sm:inline-flex" : "hidden xl:inline-flex"}
        />
      </div>
    </header>
  );
}
