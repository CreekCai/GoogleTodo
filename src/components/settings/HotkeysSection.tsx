import type { KeyboardEvent } from "react";
import type { HotkeyConfig } from "../../App";
import { Kbd } from "../ui/Kbd";

type HotkeysSectionProps = {
  hotkeys: HotkeyConfig;
  onChange: (key: keyof HotkeyConfig, value: string) => void;
  onReset: () => void;
};

const hotkeyRows: Array<{ id: keyof HotkeyConfig; label: string; description: string }> = [
  {
    id: "toggleMainWindow",
    label: "Toggle Main Window",
    description: "显示或隐藏主界面，并切换到系统托盘",
  },
  {
    id: "quickAdd",
    label: "Quick Add",
    description: "打开独立的快捷任务创建窗口",
  },
  {
    id: "search",
    label: "Search",
    description: "聚焦主界面的任务搜索框",
  },
  {
    id: "settings",
    label: "Settings",
    description: "打开设置页面",
  },
];

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

export function HotkeysSection({ hotkeys, onChange, onReset }: HotkeysSectionProps) {
  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between border-b border-hairline-soft pb-xs dark:border-surface-dark-elevated">
        <div>
          <h3 className="text-title-md text-ink dark:text-on-dark">Hotkeys</h3>
          <p className="mt-xxs text-caption text-muted dark:text-on-dark-soft">
            Click an input, then press a new key combination to replace it.
          </p>
        </div>
        <button
          className="text-caption text-muted transition-colors hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
          onClick={onReset}
        >
          Reset Defaults
        </button>
      </div>

      <div className="grid gap-sm">
        {hotkeyRows.map((row) => (
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
