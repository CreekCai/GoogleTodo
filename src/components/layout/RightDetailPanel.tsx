import { Maximize2, MoreHorizontal, X } from "lucide-react";
import type { SmartView, Task, TaskListSummary } from "../../types";
import { IconButton } from "../ui/IconButton";
import { DeleteTaskButton } from "../detail/DeleteTaskButton";
import { DetailSubtaskEditor } from "../detail/DetailSubtaskEditor";
import { TaskMetaEditor } from "../detail/TaskMetaEditor";
import { TaskNotesEditor } from "../detail/TaskNotesEditor";
import { TaskTitleEditor } from "../detail/TaskTitleEditor";

type RightDetailPanelProps = {
  task: Task | null;
  lists: TaskListSummary[];
  draftSubtaskTitle: string;
  onDraftSubtaskTitleChange: (value: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onPersistTask: (taskId: string, patch: Partial<Task>) => void;
  onAddSubtask: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onUpdateSubtask: (subtaskId: string, title: string) => void;
  onPersistSubtask: (subtaskId: string) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onDeleteTask: () => void;
};

export function RightDetailPanel({
  task,
  lists,
  draftSubtaskTitle,
  onDraftSubtaskTitleChange,
  onUpdateTask,
  onPersistTask,
  onAddSubtask,
  onToggleSubtask,
  onUpdateSubtask,
  onPersistSubtask,
  onDeleteSubtask,
  onDeleteTask,
}: RightDetailPanelProps) {
  if (!task) {
    return (
      <aside className="hidden w-96 shrink-0 border-l border-hairline bg-canvas lg:flex dark:border-surface-dark-elevated dark:bg-surface-dark">
        <p className="p-lg text-body-sm text-muted dark:text-on-dark-soft">选择一个任务查看详情</p>
      </aside>
    );
  }

  const updateDue = (dueText: string, dueLabel: SmartView) => {
    const patch = {
      dueText: dueText || undefined,
      dueLabel,
    };
    onUpdateTask(task.id, patch);
    onPersistTask(task.id, patch);
  };

  return (
    <aside className="hidden w-96 shrink-0 flex-col border-l border-hairline bg-canvas lg:flex dark:border-surface-dark-elevated dark:bg-surface-dark">
      <div className="flex h-16 items-center justify-between border-b border-hairline px-md dark:border-surface-dark-elevated">
        <IconButton label="关闭详情">
          <X size={20} />
        </IconButton>
        <span className="text-caption text-muted dark:text-on-dark-soft">Last edited {task.lastEdited}</span>
        <div className="flex items-center gap-xs">
          <IconButton label="打开独立窗口">
            <Maximize2 size={19} />
          </IconButton>
          <IconButton label="更多">
            <MoreHorizontal size={20} />
          </IconButton>
        </div>
      </div>
      <div className="app-scrollbar flex-1 space-y-xl overflow-y-auto p-lg">
        <TaskTitleEditor
          value={task.title}
          onChange={(title) => onUpdateTask(task.id, { title, lastEdited: "just now" })}
          onBlur={() => onPersistTask(task.id, { title: task.title })}
        />
        <TaskMetaEditor
          listId={task.listId}
          dueText={task.dueText}
          estimate={task.estimate}
          lists={lists}
          onListChange={(listId) => onUpdateTask(task.id, { listId, lastEdited: "just now" })}
          onDueChange={updateDue}
          onEstimateChange={(estimate) => onUpdateTask(task.id, { estimate, lastEdited: "just now" })}
        />
        <TaskNotesEditor
          value={task.notes}
          onChange={(notes) => onUpdateTask(task.id, { notes, lastEdited: "just now" })}
          onBlur={() => onPersistTask(task.id, { notes: task.notes })}
        />
        <DetailSubtaskEditor
          subtasks={task.subtasks}
          draftTitle={draftSubtaskTitle}
          onDraftTitleChange={onDraftSubtaskTitleChange}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onUpdateSubtask={onUpdateSubtask}
          onPersistSubtask={onPersistSubtask}
          onDeleteSubtask={onDeleteSubtask}
        />
      </div>
      <div className="border-t border-hairline p-md dark:border-surface-dark-elevated">
        <DeleteTaskButton onDelete={onDeleteTask} />
      </div>
    </aside>
  );
}
