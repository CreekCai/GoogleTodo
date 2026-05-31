import type { ResolvedThemeMode, Task, TaskListSummary } from "../../types";
import { TaskItem } from "./TaskItem";
import { NewTaskInput } from "./NewTaskInput";
import { TaskListHeader } from "./TaskListHeader";

type TaskListProps = {
  title: string;
  subtitle: string;
  tasks: Task[];
  lists: TaskListSummary[];
  selectedTaskId: string | null;
  expandedTaskIds: string[];
  showCompleted: boolean;
  theme: ResolvedThemeMode;
  newTaskTitle: string;
  onNewTaskTitleChange: (value: string) => void;
  onAddTask: () => void;
  onSelectTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onMoveTask: (taskId: string, direction: "up" | "down") => void;
  onShowCompletedChange: (checked: boolean) => void;
};

export function TaskList({
  title,
  subtitle,
  tasks,
  lists,
  selectedTaskId,
  expandedTaskIds,
  showCompleted,
  theme,
  newTaskTitle,
  onNewTaskTitleChange,
  onAddTask,
  onSelectTask,
  onToggleTask,
  onToggleSubtask,
  onMoveTask,
  onShowCompletedChange,
}: TaskListProps) {
  const completedCount = tasks.filter((task) => task.completed).length;
  const visibleTasks = showCompleted ? tasks : tasks.filter((task) => !task.completed);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas dark:bg-surface-dark">
      <div className="border-b border-hairline px-xl py-lg dark:border-surface-dark-elevated">
        <TaskListHeader
          title={title}
          subtitle={subtitle}
          showCompleted={showCompleted}
          completedCount={completedCount}
          theme={theme}
          onShowCompletedChange={onShowCompletedChange}
        />
      </div>
      <div className="border-b border-hairline bg-surface-soft p-lg dark:border-surface-dark-elevated dark:bg-surface-dark">
        <NewTaskInput
          value={newTaskTitle}
          onChange={onNewTaskTitleChange}
          onSubmit={onAddTask}
          placeholder={`Add a task for ${title.toLowerCase()}...`}
        />
      </div>
      <div className="app-scrollbar flex-1 overflow-y-auto p-lg">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-xs">
          {visibleTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              list={lists.find((list) => list.id === task.listId)}
              selected={task.id === selectedTaskId}
              expanded={expandedTaskIds.includes(task.id)}
              onSelect={onSelectTask}
              onToggleTask={onToggleTask}
              onToggleSubtask={onToggleSubtask}
              onMoveTask={onMoveTask}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
