import { CalendarDays, ChevronDown, ListChecks, Timer } from "lucide-react";
import type { SmartView, TaskListSummary } from "../../types";

type TaskMetaEditorProps = {
  listId: string;
  dueText?: string;
  estimate?: string;
  lists: TaskListSummary[];
  onListChange: (listId: string) => void;
  onDueChange: (dueText: string, dueLabel: SmartView) => void;
  onEstimateChange: (value: string) => void;
};

export function TaskMetaEditor({
  listId,
  dueText,
  estimate,
  lists,
  onListChange,
  onDueChange,
  onEstimateChange,
}: TaskMetaEditorProps) {
  return (
    <div className="space-y-sm">
      <label className="flex items-center gap-md">
        <ListChecks className="text-muted-soft" size={20} />
        <span className="relative flex-1">
          <select
            className="h-11 w-full appearance-none rounded bg-surface-soft px-sm pr-xl text-body-sm text-ink outline-none transition-colors focus:ring-1 focus:ring-primary dark:bg-surface-dark-elevated dark:text-on-dark dark:focus:ring-primary"
            value={listId}
            onChange={(event) => onListChange(event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-muted" size={16} />
        </span>
      </label>

      <div className="flex items-center gap-md">
        <CalendarDays className="text-muted-soft" size={20} />
        <button
          className="rounded px-sm py-xs text-body-sm font-medium text-ink transition-colors hover:bg-surface-soft dark:text-on-dark dark:hover:bg-surface-dark-elevated"
          onClick={() => onDueChange(dueText ? "" : "Today", dueText ? "all" : "today")}
        >
          {dueText || "Add date"}
        </button>
      </div>

      <label className="flex items-center gap-md">
        <Timer className="text-muted-soft" size={20} />
        <input
          className="h-9 w-20 rounded bg-surface-soft px-sm text-body-sm text-ink outline-none focus:ring-1 focus:ring-primary dark:bg-surface-dark-elevated dark:text-on-dark dark:focus:ring-primary"
          value={estimate ?? ""}
          onChange={(event) => onEstimateChange(event.target.value)}
          placeholder="30m"
        />
        <span className="text-caption text-muted dark:text-on-dark-soft">estimated</span>
      </label>
    </div>
  );
}
