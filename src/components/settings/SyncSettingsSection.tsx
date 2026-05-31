import type { GoogleCalendarListDto } from "../../api/googleTasks";
import { Switch } from "../ui/Switch";

type AutoSyncMode = "15" | "30" | "60" | "off";

type SyncSettingsSectionProps = {
  language: "en" | "zh";
  signedIn: boolean;
  autoSyncMode: AutoSyncMode;
  calendarLists: GoogleCalendarListDto[];
  selectedCalendarIds: string[] | null;
  loadingCalendarLists: boolean;
  calendarListMessage: string;
  onAutoSyncModeChange: (value: AutoSyncMode) => void;
  onCalendarSelectionChange: (calendarId: string, selected: boolean) => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

function autoSyncStatus(language: "en" | "zh", mode: AutoSyncMode) {
  if (mode === "off") {
    return t(language, "Auto sync is off. Use Sync Now to sync manually.", "自动同步已关闭，请使用“立即同步”手动同步。");
  }

  if (mode === "60") {
    return t(language, "Auto sync every 1 hour.", "每 1 小时自动同步。");
  }

  return t(language, `Auto sync every ${mode} minutes.`, `每 ${mode} 分钟自动同步。`);
}

export function SyncSettingsSection({
  language,
  signedIn,
  autoSyncMode,
  calendarLists,
  selectedCalendarIds,
  loadingCalendarLists,
  calendarListMessage,
  onAutoSyncModeChange,
  onCalendarSelectionChange,
}: SyncSettingsSectionProps) {
  const configuredSelection = selectedCalendarIds !== null;

  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Sync Settings", "同步设置")}
      </h3>

      <div className="rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div className="text-body-sm font-semibold text-ink dark:text-on-dark">
          {t(language, "Background auto sync", "后台自动同步")}
        </div>
        <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
          {autoSyncStatus(language, autoSyncMode)}
        </div>
        <div className="mt-md inline-flex flex-wrap rounded-full border border-hairline bg-surface-soft p-xxs dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
          {[
            ["15", t(language, "15 minutes", "15 分钟")],
            ["30", t(language, "30 minutes", "30 分钟")],
            ["60", t(language, "1 hour", "1 小时")],
            ["off", t(language, "Off", "关闭")],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-full px-lg py-xs text-button transition-colors ${
                autoSyncMode === value
                  ? "border border-hairline bg-canvas text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark"
                  : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
              }`}
              onClick={() => onAutoSyncModeChange(value as AutoSyncMode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div className="text-body-sm font-semibold text-ink dark:text-on-dark">
          {t(language, "Google Calendar Sync", "Google 日历同步")}
        </div>
        <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
          {!signedIn
            ? t(language, "Sign in to Google before choosing calendars.", "请先登录 Google，然后选择要同步的日历。")
            : calendarListMessage || t(language, "Choose which calendars should appear in the task views.", "选择要显示在任务视图中的日历。")}
        </div>

        {signedIn ? (
          <div className="mt-md space-y-sm">
            {loadingCalendarLists ? (
              <div className="rounded-lg bg-surface-soft p-sm text-body-sm text-muted dark:bg-surface-dark-elevated dark:text-on-dark-soft">
                {t(language, "Loading calendars...", "正在加载日历清单...")}
              </div>
            ) : null}
            {!loadingCalendarLists && calendarLists.length === 0 ? (
              <div className="rounded-lg bg-surface-soft p-sm text-body-sm text-muted dark:bg-surface-dark-elevated dark:text-on-dark-soft">
                {t(language, "No calendars returned from Google.", "Google 未返回可同步的日历。")}
              </div>
            ) : null}
            {calendarLists.map((calendar) => {
              const checked = configuredSelection
                ? selectedCalendarIds.includes(calendar.id)
                : calendar.selected;
              return (
                <div
                  key={calendar.id}
                  className="flex items-center justify-between rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-sm text-body-sm font-semibold text-ink dark:text-on-dark">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: calendar.color ?? "#8b5cf6" }}
                      />
                      <span className="truncate">{calendar.name}</span>
                    </div>
                    <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
                      {calendar.primary
                        ? t(language, "Primary calendar", "主日历")
                        : t(language, "Google Calendar", "Google 日历")}
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    onChange={(value) => onCalendarSelectionChange(calendar.id, value)}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export type { AutoSyncMode };
