import type { CloseButtonBehavior } from "../../App";
import { Switch } from "../ui/Switch";

type StartupSectionProps = {
  language: "en" | "zh";
  enabled: boolean;
  saving: boolean;
  message: string;
  minimizeOnLaunch: boolean;
  closeButtonBehavior: CloseButtonBehavior;
  onChange: (enabled: boolean) => void;
  onMinimizeOnLaunchChange: (enabled: boolean) => void;
  onCloseButtonBehaviorChange: (behavior: CloseButtonBehavior) => void;
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
  closeButtonBehavior,
  onChange,
  onMinimizeOnLaunchChange,
  onCloseButtonBehaviorChange,
}: StartupSectionProps) {
  const closeBehaviorOptions: Array<{ value: CloseButtonBehavior; label: string }> = [
    { value: "exit", label: t(language, "Close app", "关闭应用") },
    { value: "minimizeToTray", label: t(language, "Minimize to tray", "最小化到托盘") },
  ];

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
      <div className="flex flex-col gap-md rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-body-sm font-semibold text-ink dark:text-on-dark">
            {t(language, "When clicking the window close button", "点击窗口关闭按钮时")}
          </div>
          <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            {t(language, "Choose whether Google Todo exits or keeps running from the tray.", "选择关闭应用，或保持在托盘中继续运行。")}
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-hairline bg-surface-soft p-xxs dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
          {closeBehaviorOptions.map((option) => {
            const active = closeButtonBehavior === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`min-w-[7rem] rounded-full px-md py-xs text-button transition-colors ${
                  active
                    ? "border border-hairline bg-canvas text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark"
                    : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
                }`}
                onClick={() => onCloseButtonBehaviorChange(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
