import { CheckCircle2, LogOut } from "lucide-react";
import { Button } from "../ui/Button";

type GoogleAccountSectionProps = {
  language: "en" | "zh";
  signedIn: boolean;
  syncing: boolean;
  userName: string;
  userEmail: string;
  userPicture: string;
  onLogin: () => void;
  onSync: () => void;
  onSignOut: () => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function GoogleAccountSection({
  language,
  signedIn,
  syncing,
  userName,
  userEmail,
  userPicture,
  onLogin,
  onSync,
  onSignOut,
}: GoogleAccountSectionProps) {
  const initials = signedIn ? (userName || userEmail || "GT").slice(0, 2).toUpperCase() : t(language, "NO", "未");

  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Google Account", "Google 账户")}
      </h3>
      <div className="flex items-start justify-between rounded-lg border border-hairline bg-surface-card p-lg dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        <div className="flex items-center gap-md">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-badge-emerald text-title-md text-on-dark shadow-subtle">
            {signedIn && userPicture ? (
              <img className="h-full w-full rounded-full object-cover" src={userPicture} alt={userName || userEmail || "Google user"} />
            ) : (
              initials
            )}
          </div>
          <div>
            <div className="text-title-md text-ink dark:text-on-dark">
              {signedIn ? userName || t(language, "Google Tasks User", "Google Tasks 用户") : t(language, "Not signed in", "未登录")}
            </div>
            <div className="text-body-sm text-muted dark:text-on-dark-soft">
              {signedIn ? userEmail || t(language, "Email not returned", "邮箱信息未返回") : t(language, "Please sign in to Google Tasks", "请登录 Google Tasks")}
            </div>
            <div className="mt-xs inline-flex items-center gap-xxs text-caption text-success">
              <CheckCircle2 size={14} />
              {signedIn
                ? t(language, "Tasks sync automatically after sign-in. You can also sync manually.", "登录后会自动同步任务；也可以手动同步。")
                : t(language, "Click Sign in to open the system browser for authorization.", "点击登录会打开系统浏览器完成授权。")}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-sm">
          {signedIn ? (
            <>
              <Button onClick={onSync} disabled={syncing}>{syncing ? t(language, "Syncing", "同步中") : t(language, "Sync Now", "立即同步")}</Button>
              <Button variant="secondary" onClick={onSignOut}>
                <LogOut size={16} />
                {t(language, "Sign out", "退出登录")}
              </Button>
            </>
          ) : (
            <Button onClick={onLogin} disabled={syncing}>{syncing ? t(language, "Opening", "打开中") : t(language, "Sign in", "登录")}</Button>
          )}
        </div>
      </div>
    </section>
  );
}
