import { GitBranch, Plus, X } from "lucide-react";
import type { Subtask } from "../../types";
import { CompletionToggle } from "../tasks/CompletionToggle";
import { IconButton } from "../ui/IconButton";
import { cn } from "../../lib/classNames";

type DetailSubtaskEditorProps = {
  subtasks: Subtask[];
  draftTitle: string;
  onDraftTitleChange: (value: string) => void;
  onAddSubtask: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onUpdateSubtask: (subtaskId: string, title: string) => void;
  onPersistSubtask: (subtaskId: string) => void;
  onDeleteSubtask: (subtaskId: string) => void;
};

export function DetailSubtaskEditor({
  subtasks,
  draftTitle,
  onDraftTitleChange,
  onAddSubtask,
  onToggleSubtask,
  onUpdateSubtask,
  onPersistSubtask,
  onDeleteSubtask,
}: DetailSubtaskEditorProps) {
  const completedCount = subtasks.filter((subtask) => subtask.completed).length;

  return (
    <section>
      <div className="mb-sm flex items-center justify-between">
        <h3 className="inline-flex items-center gap-xs text-title-md text-ink dark:text-on-dark">
          <GitBranch size={17} />
          Subtasks
        </h3>
        <span className="text-caption text-muted dark:text-on-dark-soft">
          {completedCount}/{subtasks.length}
        </span>
      </div>
      <div className="space-y-sm">
        {subtasks.map((subtask) => (
          <div key={subtask.id} className="group flex items-center gap-sm">
            <CompletionToggle checked={subtask.completed} size="sm" onClick={() => onToggleSubtask(subtask.id)} />
            <input
              className={cn(
                "min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-body-sm outline-none transition-colors hover:border-hairline focus:border-primary focus:ring-0 dark:text-on-dark dark:focus:border-primary",
                subtask.completed && "text-muted line-through dark:text-on-dark-soft",
              )}
              value={subtask.title}
              onChange={(event) => onUpdateSubtask(subtask.id, event.target.value)}
              onBlur={() => onPersistSubtask(subtask.id)}
            />
            <IconButton
              label="删除子任务"
              className="h-7 w-7 opacity-0 group-hover:opacity-100"
              onClick={() => onDeleteSubtask(subtask.id)}
            >
              <X size={16} />
            </IconButton>
          </div>
        ))}
        <form
          className="flex items-center gap-sm pt-xs text-muted"
          onSubmit={(event) => {
            event.preventDefault();
            onAddSubtask();
          }}
        >
          <Plus size={18} />
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-body-sm text-ink outline-none placeholder:text-muted focus:ring-0 dark:text-on-dark"
            value={draftTitle}
            onChange={(event) => onDraftTitleChange(event.target.value)}
            placeholder="Add subtask"
          />
        </form>
      </div>
    </section>
  );
}
