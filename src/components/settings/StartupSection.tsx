import { Switch } from "../ui/Switch";

type StartupSectionProps = {
  enabled: boolean;
  saving: boolean;
  message: string;
  minimizeOnLaunch: boolean;
  onChange: (enabled: boolean) => void;
  onMinimizeOnLaunchChange: (enabled: boolean) => void;
};

export function StartupSection({
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
        Startup
      </h3>
      <div className="flex items-center justify-between rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div>
          <div className="text-body-sm font-semibold text-ink dark:text-on-dark">Launch at startup</div>
          <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            Start Google Todo automatically when Windows signs in.
          </div>
          <div className="mt-xs min-h-5 text-caption text-muted dark:text-on-dark-soft">
            {saving ? "Saving startup setting..." : message}
          </div>
        </div>
        <Switch checked={enabled} onChange={onChange} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
        <div>
          <div className="text-body-sm font-semibold text-ink dark:text-on-dark">Start minimized after launch</div>
          <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            Hide the main window to the system tray after the app starts.
          </div>
        </div>
        <Switch checked={minimizeOnLaunch} onChange={onMinimizeOnLaunchChange} />
      </div>
    </section>
  );
}
