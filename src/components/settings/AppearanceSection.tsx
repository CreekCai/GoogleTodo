import type { ThemeMode } from "../../types";
import { cn } from "../../lib/classNames";

type AppearanceSectionProps = {
  language: "en" | "zh";
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function AppearanceSection({ language, value, onChange }: AppearanceSectionProps) {
  const modes: Array<{ id: ThemeMode; label: string }> = [
    { id: "light", label: t(language, "Light", "浅色") },
    { id: "dark", label: t(language, "Dark", "深色") },
    { id: "system", label: t(language, "System", "跟随系统") },
  ];

  return (
    <section className="space-y-md">
      <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
        {t(language, "Appearance", "外观")}
      </h3>
      <div className="inline-flex rounded-full border border-hairline bg-surface-soft p-xxs dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={cn(
              "rounded-full px-lg py-xs text-button transition-colors",
              value === mode.id
                ? "border border-hairline bg-canvas text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark"
                : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark",
            )}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </section>
  );
}
