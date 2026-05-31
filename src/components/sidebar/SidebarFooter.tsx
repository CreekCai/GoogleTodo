import { Cloud, Plus, Settings } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

type SidebarFooterProps = {
  onCreateList: () => void;
  onOpenSettings: () => void;
};

export function SidebarFooter({ onCreateList, onOpenSettings }: SidebarFooterProps) {
  return (
    <div className="mt-auto border-t border-hairline pt-md dark:border-surface-dark-elevated">
      <Button className="mb-md w-full justify-start" onClick={onCreateList}>
        <Plus size={18} />
        New List
      </Button>
      <div className="flex items-center justify-between">
        <IconButton label="打开设置" onClick={onOpenSettings}>
          <Settings size={20} />
        </IconButton>
        <IconButton label="同步状态">
          <Cloud size={19} />
        </IconButton>
      </div>
    </div>
  );
}
