import { ChevronsUpDown, UserRound } from "lucide-react";
import { IconButton } from "../ui/IconButton";

export function UserProfile() {
  return (
    <div className="flex items-center gap-sm">
      <div className="grid h-10 w-10 place-items-center rounded-full border border-hairline bg-surface-card text-muted dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark-soft">
        <UserRound size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-title-md text-ink dark:text-on-dark">Task User</div>
        <div className="truncate text-caption text-muted dark:text-on-dark-soft">Google Tasks Pro</div>
      </div>
      <IconButton label="账户菜单" className="h-8 w-8">
        <ChevronsUpDown size={18} />
      </IconButton>
    </div>
  );
}
