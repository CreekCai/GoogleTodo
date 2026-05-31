import { Switch } from "../ui/Switch";

type TaskDisplaySectionProps = {
  language: "en" | "zh";
  showCompleted: boolean;
  showTaskCount: boolean;
  onShowCompletedChange: (value: boolean) => void;
  onShowTaskCountChange: (value: boolean) => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function TaskDisplaySection({
  language,
  showCompleted,
  showTaskCount,
  onShowCompletedChange,
  onShowTaskCountChange,
}: TaskDisplaySectionProps) {
  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Task Display", "任务显示")}
      </h3>
      <div className="space-y-sm">
        <label className="flex items-center justify-between rounded-lg p-sm text-body-sm text-body hover:bg-surface-soft dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated">
          {t(language, "Show completed tasks", "显示已完成任务")}
          <Switch checked={showCompleted} onChange={onShowCompletedChange} />
        </label>
        <label className="flex items-center justify-between rounded-lg p-sm text-body-sm text-body hover:bg-surface-soft dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated">
          {t(language, "Show task count", "显示任务数量")}
          <Switch checked={showTaskCount} onChange={onShowTaskCountChange} />
        </label>
      </div>
    </section>
  );
}
