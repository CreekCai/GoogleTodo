import type { GoogleProxyConfig, GoogleProxyMode } from "../../api/googleTasks";
import { cn } from "../../lib/classNames";
import { Button } from "../ui/Button";

type GoogleProxySectionProps = {
  language: "en" | "zh";
  value: GoogleProxyConfig;
  saving: boolean;
  message: string;
  lastError: string;
  onChange: (value: GoogleProxyConfig) => void;
  onSave: () => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function GoogleProxySection({
  language,
  value,
  saving,
  message,
  lastError,
  onChange,
  onSave,
}: GoogleProxySectionProps) {
  const modes: Array<{ id: GoogleProxyMode; label: string; description: string }> = [
    { id: "system", label: t(language, "Use system proxy", "使用系统代理"), description: t(language, "Follow the system proxy from Windows or your VPN", "跟随 Windows 或 VPN 的系统代理设置") },
    { id: "custom", label: t(language, "Custom HTTP proxy", "自定义 HTTP 代理"), description: t(language, "Enter a proxy address manually, for example http://127.0.0.1:7890", "手动填写代理地址，例如 http://127.0.0.1:7890") },
    { id: "none", label: t(language, "No proxy", "不使用代理"), description: t(language, "Connect to Google services directly", "直接连接 Google 服务") },
  ];

  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Google Proxy", "Google 代理")}
      </h3>
      <div className="space-y-sm rounded-lg border border-hairline bg-surface-card p-lg dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        <div className="grid gap-sm md:grid-cols-3">
          {modes.map((mode) => (
            <button
              key={mode.id}
              className={cn(
                "rounded-lg border p-md text-left transition-colors",
                value.mode === mode.id
                  ? "border-primary bg-surface-soft text-ink dark:border-on-dark dark:bg-surface-dark dark:text-on-dark"
                  : "border-hairline-soft text-muted hover:border-hairline hover:text-ink dark:border-surface-dark-elevated dark:text-on-dark-soft dark:hover:text-on-dark",
              )}
              onClick={() => onChange({ mode: mode.id, url: mode.id === "custom" ? value.url : "" })}
            >
              <div className="text-button">{mode.label}</div>
              <div className="mt-xs text-caption">{mode.description}</div>
            </button>
          ))}
        </div>

        {value.mode === "custom" ? (
          <label className="block space-y-xs">
            <span className="text-caption text-muted dark:text-on-dark-soft">{t(language, "HTTP proxy URL", "HTTP 代理地址")}</span>
            <input
              className="h-10 w-full rounded border border-hairline bg-canvas px-sm text-body-sm text-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark dark:focus:border-on-dark dark:focus:ring-on-dark"
              value={value.url}
              onChange={(event) => onChange({ ...value, url: event.target.value })}
              placeholder="http://127.0.0.1:7890"
            />
          </label>
        ) : null}

        <div className="flex items-center justify-between gap-md">
          <p className="text-caption text-muted dark:text-on-dark-soft">{message}</p>
          <Button onClick={onSave} disabled={saving}>
            {saving ? t(language, "Saving...", "保存中...") : t(language, "Save proxy settings", "保存代理设置")}
          </Button>
        </div>
        {lastError ? (
          <div className="rounded border border-danger/40 bg-danger/10 p-sm text-caption text-danger">
            <div className="mb-xs font-semibold">{t(language, "Latest Google error details", "最近一次 Google 错误详情")}</div>
            <pre className="max-h-40 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {lastError}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
