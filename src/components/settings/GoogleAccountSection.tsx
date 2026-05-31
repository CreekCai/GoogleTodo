import { CheckCircle2, LogOut } from "lucide-react";
import { Button } from "../ui/Button";

type GoogleAccountSectionProps = {
  signedIn: boolean;
  syncing: boolean;
  userName: string;
  userEmail: string;
  onLogin: () => void;
  onSync: () => void;
  onSignOut: () => void;
};

export function GoogleAccountSection({
  signedIn,
  syncing,
  userName,
  userEmail,
  onLogin,
  onSync,
  onSignOut,
}: GoogleAccountSectionProps) {
  const initials = signedIn ? (userName || userEmail || "GT").slice(0, 2).toUpperCase() : "未";

  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        Google Account
      </h3>
      <div className="flex items-start justify-between rounded-lg border border-hairline bg-surface-card p-lg dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        <div className="flex items-center gap-md">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-badge-emerald text-title-md text-on-dark">
            {initials}
          </div>
          <div>
            <div className="text-title-md text-ink dark:text-on-dark">
              {signedIn ? userName || "Google Tasks 用户" : "未登录"}
            </div>
            <div className="text-body-sm text-muted dark:text-on-dark-soft">
              {signedIn ? userEmail || "邮箱信息未返回" : "请登录 Google Tasks"}
            </div>
            <div className="mt-xs inline-flex items-center gap-xxs text-caption text-success">
              <CheckCircle2 size={14} />
              {signedIn ? "Tasks sync automatically after sign-in. You can also sync manually." : "Click Sign in to open the system browser for authorization."}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-sm">
          {signedIn ? (
            <>
              <Button onClick={onSync} disabled={syncing}>{syncing ? "Syncing" : "Sync Now"}</Button>
              <Button variant="secondary" onClick={onSignOut}>
                <LogOut size={16} />
                Sign out
              </Button>
            </>
          ) : (
            <Button onClick={onLogin} disabled={syncing}>{syncing ? "Opening" : "Sign in"}</Button>
          )}
        </div>
      </div>
    </section>
  );
}
