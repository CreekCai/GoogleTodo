import type { KeyboardEvent } from "react";
import type { HotkeyConfig } from "../../App";
import { Kbd } from "../ui/Kbd";

type HotkeysSectionProps = {
  language: "en" | "zh";
  hotkeys: HotkeyConfig;
  onChange: (key: keyof HotkeyConfig, value: string) => void;
  onReset: () => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

function hotkeyRows(language: "en" | "zh"): Array<{ id: keyof HotkeyConfig; label: string; description: string }> {
  return [
    {
      id: "toggleMainWindow",
      label: t(language, "Toggle Main Window", "显示/隐藏主窗口"),
      description: t(language, "Show or hide the main window and keep it available from the system tray.", "显示或隐藏主界面，并保留在系统托盘中。"),
    },
    {
      id: "quickAdd",
      label: t(language, "Quick Add", "快捷录入"),
      description: t(language, "Open the standalone quick task creation window.", "打开独立的快捷任务创建窗口。"),
    },
    {
      id: "search",
      label: t(language, "Search", "搜索"),
      description: t(language, "Focus the task search box in the main window.", "聚焦主界面的任务搜索框。"),
    },
    {
      id: "settings",
      label: t(language, "Settings", "设置"),
      description: t(language, "Open the settings window.", "打开设置页面。"),
    },
  ];
}

function eventToHotkey(event: KeyboardEvent<HTMLInputElement>) {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!["Control", "Meta", "Alt", "Shift"].includes(key)) {
    parts.push(key);
  }

  return parts.length > 1 ? parts.join("+") : "";
}

function HotkeyPreview({ value }: { value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-xxs">
      {value.split("+").map((key, index) => (
        <span className="inline-flex items-center gap-xxs" key={`${value}-${key}-${index}`}>
          {index > 0 ? <span className="text-muted">+</span> : null}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </div>
  );
}

export function HotkeysSection({ language, hotkeys, onChange, onReset }: HotkeysSectionProps) {
  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between border-b border-hairline-soft pb-xs dark:border-surface-dark-elevated">
        <div>
          <h3 className="text-title-md text-ink dark:text-on-dark">{t(language, "Hotkeys", "快捷键")}</h3>
          <p className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            {t(language, "Click an input, then press a new key combination to replace it.", "点击输入框后，直接按下新的组合键即可替换。")}
          </p>
        </div>
        <button
          className="text-caption text-muted transition-colors hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
          onClick={onReset}
        >
          {t(language, "Reset Defaults", "恢复默认")}
        </button>
      </div>

      <div className="grid gap-sm">
        {hotkeyRows(language).map((row) => (
          <div
            key={row.id}
            className="grid gap-sm rounded-lg border border-hairline bg-canvas p-sm md:grid-cols-[1fr_180px] md:items-center dark:border-surface-dark-elevated dark:bg-surface-dark"
          >
            <div>
              <div className="text-body-sm font-semibold text-ink dark:text-on-dark">{row.label}</div>
              <div className="mt-xxs text-caption text-muted dark:text-on-dark-soft">{row.description}</div>
            </div>
            <div className="grid gap-xs">
              <input
                className="h-10 rounded border border-hairline bg-surface-soft px-sm text-body-sm text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark"
                value={hotkeys[row.id]}
                readOnly
                onKeyDown={(event) => {
                  event.preventDefault();
                  const nextHotkey = eventToHotkey(event);
                  if (nextHotkey) {
                    onChange(row.id, nextHotkey);
                  }
                }}
                aria-label={`${row.label} hotkey`}
              />
              <HotkeyPreview value={hotkeys[row.id]} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
