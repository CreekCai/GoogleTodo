import type { SmartView, Task, TaskListSummary } from "../../types";
import { SidebarFooter } from "../sidebar/SidebarFooter";
import { SidebarSearch } from "../sidebar/SidebarSearch";
import { SmartFilterNav } from "../sidebar/SmartFilterNav";
import { TaskListNav } from "../sidebar/TaskListNav";
import { UserProfile } from "../sidebar/UserProfile";

type SidebarProps = {
  lists: TaskListSummary[];
  tasks: Task[];
  activeListId: string;
  activeSmartView: SmartView | null;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelectList: (listId: string) => void;
  onSelectSmartView: (view: SmartView) => void;
  onCreateList: () => void;
  onOpenSettings: () => void;
};

export function Sidebar({
  lists,
  tasks,
  activeListId,
  activeSmartView,
  searchValue,
  onSearchChange,
  onSelectList,
  onSelectSmartView,
  onCreateList,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-hairline bg-surface p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
      <UserProfile />
      <div className="mt-lg">
        <SidebarSearch value={searchValue} onChange={onSearchChange} />
      </div>
      <div className="app-scrollbar mt-lg flex-1 space-y-lg overflow-y-auto pr-1">
        <SmartFilterNav activeView={activeSmartView} tasks={tasks} onSelect={onSelectSmartView} />
        <TaskListNav
          lists={lists}
          tasks={tasks}
          activeListId={activeListId}
          activeSmartView={activeSmartView}
          onSelect={onSelectList}
        />
      </div>
      <SidebarFooter onCreateList={onCreateList} onOpenSettings={onOpenSettings} />
    </aside>
  );
}
