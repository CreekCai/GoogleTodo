import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
import type { Task, TaskListSummary } from "../../types";
import { cn } from "../../lib/classNames";
import { CompletionToggle } from "./CompletionToggle";
import { SubtaskList } from "./SubtaskList";
import { TaskMetaBadge } from "./TaskMetaBadge";

type TaskItemProps = {
  task: Task;
  list?: TaskListSummary;
  selected: boolean;
  expanded: boolean;
  onSelect: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onMoveTask: (taskId: string, direction: "up" | "down") => void;
};

export function TaskItem({
  task,
  list,
  selected,
  expanded,
  onSelect,
  onToggleTask,
  onToggleSubtask,
  onMoveTask,
}: TaskItemProps) {
  const completedSubtasks = task.subtasks.filter((subtask) => subtask.completed).length;
  const ListIcon = list?.icon;

  return (
    <article
      className={cn(
        "group cursor-pointer rounded-lg border p-md transition-all",
        selected
          ? "border-primary bg-surface-soft shadow-subtle dark:border-on-dark dark:bg-surface-dark-elevated"
          : "border-transparent bg-canvas hover:border-hairline hover:bg-surface-card dark:bg-surface-dark dark:hover:border-surface-dark-elevated dark:hover:bg-surface-dark-elevated",
        task.completed && "opacity-55",
      )}
      onClick={() => onSelect(task.id)}
    >
      <div className="flex items-start gap-md">
        <CompletionToggle checked={task.completed} onClick={() => onToggleTask(task.id)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-sm">
            <h3
              className={cn(
                selected ? "text-title-md font-semibold" : "text-body-md",
                "truncate text-ink dark:text-on-dark",
                task.completed && "text-muted line-through dark:text-on-dark-soft",
              )}
            >
              {task.title}
            </h3>
            <div className="flex shrink-0 items-center gap-xs">
              {task.dueText ? <TaskMetaBadge type="date" label={task.dueText} /> : null}
              {task.estimate ? <TaskMetaBadge type="estimate" label={task.estimate} /> : null}
              <button
                className="grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface-soft hover:text-ink group-hover:opacity-100 dark:hover:bg-surface-dark"
                title="上移任务"
                aria-label="上移任务"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveTask(task.id, "up");
                }}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface-soft hover:text-ink group-hover:opacity-100 dark:hover:bg-surface-dark"
                title="下移任务"
                aria-label="下移任务"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveTask(task.id, "down");
                }}
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
          <div className="mt-xs flex flex-wrap items-center gap-md text-caption text-muted dark:text-on-dark-soft">
            {list && ListIcon ? (
              <span className="inline-flex items-center gap-1">
                <ListIcon className={list.iconClassName} size={14} />
                {list.name}
              </span>
            ) : null}
            {task.priority ? (
              <TaskMetaBadge
                type="priority"
                label={task.priority === "high" ? "High" : task.priority === "medium" ? "Medium" : "Low"}
                priority={task.priority}
              />
            ) : null}
            {task.subtasks.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch size={14} />
                {completedSubtasks}/{task.subtasks.length} subtasks
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {expanded && task.subtasks.length > 0 ? (
        <div className="mt-md">
          <SubtaskList
            subtasks={task.subtasks}
            compact
            onToggleSubtask={(subtaskId) => onToggleSubtask(task.id, subtaskId)}
          />
        </div>
      ) : null}
    </article>
  );
}
