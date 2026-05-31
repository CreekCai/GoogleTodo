import { Switch } from "../ui/Switch";

type StartupSectionProps = {
  language: "en" | "zh";
  enabled: boolean;
  saving: boolean;
  message: string;
  minimizeOnLaunch: boolean;
  onChange: (enabled: boolean) => void;
  onMinimizeOnLaunchChange: (enabled: boolean) => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function StartupSection({
  language,
  enabled,
  saving,
  message,
  minimizeOnLaunch,
  onChange,
  onMinimizeOnLaunchChange,
}: StartupSectionProps) {
  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Startup", "启动")}
      </h3>
      <div className="flex items-center justify-between rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div>
          <div className="text-body-sm font-semibold text-ink dark:text-on-dark">{t(language, "Launch at startup", "开机自启动")}</div>
          <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            {t(language, "Start Google Todo automatically when Windows signs in.", "Windows 登录后自动启动 Google Todo。")}
          </div>
          <div className="mt-xs min-h-5 text-caption text-muted dark:text-on-dark-soft">
            {saving ? t(language, "Saving startup setting...", "正在保存开机自启动设置...") : message}
          </div>
        </div>
        <Switch checked={enabled} onChange={onChange} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div>
          <div className="text-body-sm font-semibold text-ink dark:text-on-dark">{t(language, "Start minimized after launch", "启动后自动最小化")}</div>
          <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            {t(language, "Hide the main window to the system tray after the app starts.", "应用启动后自动隐藏主窗口到系统托盘。")}
          </div>
        </div>
        <Switch checked={minimizeOnLaunch} onChange={onMinimizeOnLaunchChange} />
      </div>
    </section>
  );
}
