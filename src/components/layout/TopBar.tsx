import { Bell, Cloud, LogIn, Moon, MoreVertical, RefreshCw, Search, Sun, Zap } from "lucide-react";
import type { ResolvedThemeMode, WorkspaceTab } from "../../types";
import { cn } from "../../lib/classNames";
import { IconButton } from "../ui/IconButton";

type TopBarProps = {
  activeTab: WorkspaceTab;
  theme: ResolvedThemeMode;
  searchValue: string;
  onTabChange: (tab: WorkspaceTab) => void;
  onSearchChange: (value: string) => void;
  onToggleTheme: () => void;
  onOpenQuickAdd: () => void;
  googleConfigured: boolean;
  googleSignedIn: boolean;
  googleSyncing: boolean;
  syncMessage: string;
  onGoogleLogin: () => void;
  onGoogleSync: () => void;
};

const tabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
  { id: "calendar", label: "Calendar" },
];

export function TopBar({
  activeTab,
  theme,
  searchValue,
  onTabChange,
  onSearchChange,
  onToggleTheme,
  onOpenQuickAdd,
  googleConfigured,
  googleSignedIn,
  googleSyncing,
  syncMessage,
  onGoogleLogin,
  onGoogleSync,
}: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-canvas px-lg dark:border-surface-dark-elevated dark:bg-surface-dark">
      <div className="flex items-center gap-xl">
        <h1 className="font-display text-display-sm text-ink dark:text-on-dark">Tasks Client</h1>
        <nav className="flex h-16 items-end gap-lg" aria-label="视图切换">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "border-b-2 pb-sm text-body-sm transition-colors",
                activeTab === tab.id
                  ? "border-primary font-semibold text-primary dark:border-on-dark dark:text-on-dark"
                  : "border-transparent text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark",
              )}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-sm">
        <span className="hidden max-w-48 truncate text-caption text-muted dark:text-on-dark-soft xl:inline">
          {syncMessage}
        </span>
        {googleSignedIn ? (
          <IconButton
            label="同步 Google Tasks"
            disabled={googleSyncing}
            onClick={onGoogleSync}
          >
            {googleSyncing ? <RefreshCw className="animate-spin" size={20} /> : <Cloud size={20} />}
          </IconButton>
        ) : (
          <IconButton
            label={googleConfigured ? "登录 Google" : "先配置 Google Client ID"}
            disabled={googleSyncing}
            onClick={onGoogleLogin}
          >
            <LogIn size={20} />
          </IconButton>
        )}
        <label className="relative hidden lg:block">
          <Search className="absolute left-sm top-1/2 -translate-y-1/2 text-muted" size={18} />
          <input
            className="h-10 w-60 rounded border border-hairline bg-surface-card pl-xl pr-sm text-body-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-outline focus:bg-canvas focus:ring-1 focus:ring-outline dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark dark:focus:border-on-dark dark:focus:ring-on-dark"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search tasks..."
          />
        </label>
        <IconButton label="快速新增任务" onClick={onOpenQuickAdd}>
          <Zap size={20} />
        </IconButton>
        <IconButton label="切换主题" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </IconButton>
        <IconButton label="通知">
          <Bell size={20} />
        </IconButton>
        <IconButton label="更多操作">
          <MoreVertical size={20} />
        </IconButton>
      </div>
    </header>
  );
}
