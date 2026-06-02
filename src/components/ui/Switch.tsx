import { cn } from "../../lib/classNames";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
};

export function Switch({ checked, onChange, label, className }: SwitchProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-sm", className)}>
      {label ? <span className="text-caption text-muted dark:text-on-dark-soft">{label}</span> : null}
      <span className="relative inline-flex h-6 w-11 items-center">
        <input
          className="sr-only"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span
          className={cn(
            "absolute inset-0 rounded-full border transition-colors",
            checked
              ? "border-primary bg-primary dark:border-primary dark:bg-primary"
              : "border-hairline bg-surface-strong dark:border-surface-tint dark:bg-surface-dark-elevated",
          )}
        />
        <span
          className={cn(
            "relative ml-1 h-4 w-4 rounded-full bg-canvas shadow-subtle transition-transform dark:bg-surface-dark",
            checked && "translate-x-5 dark:bg-surface-dark",
          )}
        />
      </span>
    </label>
  );
}
