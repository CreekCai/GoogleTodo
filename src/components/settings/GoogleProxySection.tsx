import type { GoogleProxyConfig, GoogleProxyMode } from "../../api/googleTasks";
import { cn } from "../../lib/classNames";
import { Button } from "../ui/Button";

type GoogleProxySectionProps = {
  value: GoogleProxyConfig;
  saving: boolean;
  message: string;
  lastError: string;
  onChange: (value: GoogleProxyConfig) => void;
  onSave: () => void;
};

const modes: Array<{ id: GoogleProxyMode; label: string; description: string }> = [
  { id: "system", label: "Use system proxy", description: "Follow the system proxy from Windows or your VPN" },
  { id: "custom", label: "Custom HTTP proxy", description: "Enter a proxy address manually, for example http://127.0.0.1:7890" },
  { id: "none", label: "No proxy", description: "Connect to Google services directly" },
];

export function GoogleProxySection({
  value,
  saving,
  message,
  lastError,
  onChange,
  onSave,
}: GoogleProxySectionProps) {
  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        Google Proxy
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
            <span className="text-caption text-muted dark:text-on-dark-soft">HTTP proxy URL</span>
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
            {saving ? "Saving..." : "Save proxy settings"}
          </Button>
        </div>
        {lastError ? (
          <div className="rounded border border-danger/40 bg-danger/10 p-sm text-caption text-danger">
            <div className="mb-xs font-semibold">Latest Google error details</div>
            <pre className="max-h-40 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {lastError}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
