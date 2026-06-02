import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Info, RefreshCw } from "lucide-react";

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function AboutSection({ language }: { language: "en" | "zh" }) {
  const [version, setVersion] = useState("0.1.13");
  const [checking, setChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    setUpdateMessage(t(language, "Checking for updates...", "正在检查更新..."));
    try {
      const update = await check();
      if (!update) {
        setUpdateMessage(t(language, "You are on the latest version.", "当前已是最新版本。"));
        return;
      }

      setUpdateMessage(
        t(language, `Downloading version ${update.version}...`, `正在下载 ${update.version} 版本...`),
      );
      await update.downloadAndInstall();
      setUpdateMessage(t(language, "Update installed. Restarting...", "更新已安装，正在重启..."));
      await relaunch();
    } catch (error) {
      setUpdateMessage(`${t(language, "Update failed: ", "更新失败：")}${String(error)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="space-y-md border-t border-hairline-soft pt-xl dark:border-surface-dark-elevated">
      <h3 className="inline-flex items-center gap-sm text-title-md text-ink dark:text-on-dark">
        <Info size={18} />
        {t(language, "About", "关于")}
      </h3>
      <div className="space-y-md rounded-lg border border-hairline bg-surface p-md text-body-sm text-body dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark-soft">
        <div>
          <span className="font-semibold text-ink dark:text-on-dark">Google Todo v{version}</span>
          {t(
            language,
            ". A Google Tasks and Google Calendar desktop client built with Tauri, React, TypeScript, and Tailwind CSS.",
            "。一个使用 Tauri、React、TypeScript 和 Tailwind CSS 构建的 Google Tasks 和 Google Calendar 桌面客户端。",
          )}
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <button
            className="inline-flex h-9 items-center gap-xs rounded-lg border border-hairline bg-canvas px-sm text-button text-ink shadow-subtle transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark dark:hover:bg-surface-dark-elevated"
            disabled={checking}
            onClick={checkForUpdates}
          >
            <RefreshCw size={16} className={checking ? "animate-spin" : ""} />
            {checking ? t(language, "Checking", "检查中") : t(language, "Check for updates", "检查更新")}
          </button>
          {updateMessage ? (
            <span className="text-caption text-muted dark:text-on-dark-soft">{updateMessage}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
