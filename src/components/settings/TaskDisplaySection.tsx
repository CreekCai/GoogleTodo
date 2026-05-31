import { Switch } from "../ui/Switch";

type TaskDisplaySectionProps = {
  showCompleted: boolean;
  showTaskCount: boolean;
  onShowCompletedChange: (value: boolean) => void;
  onShowTaskCountChange: (value: boolean) => void;
};

export function TaskDisplaySection({
  showCompleted,
  showTaskCount,
  onShowCompletedChange,
  onShowTaskCountChange,
}: TaskDisplaySectionProps) {
  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        Task Display
      </h3>
      <div className="space-y-sm">
        <label className="flex items-center justify-between rounded-lg p-sm text-body-sm text-body hover:bg-surface-soft dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated">
          Show completed tasks
          <Switch checked={showCompleted} onChange={onShowCompletedChange} />
        </label>
        <label className="flex items-center justify-between rounded-lg p-sm text-body-sm text-body hover:bg-surface-soft dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated">
          Show task count
          <Switch checked={showTaskCount} onChange={onShowTaskCountChange} />
        </label>
      </div>
    </section>
  );
}
