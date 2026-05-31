import { Info } from "lucide-react";

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function AboutSection({ language }: { language: "en" | "zh" }) {
  return (
    <section className="space-y-md border-t border-hairline-soft pt-xl dark:border-surface-dark-elevated">
      <h3 className="inline-flex items-center gap-sm text-title-md text-ink dark:text-on-dark">
        <Info size={18} />
        {t(language, "About", "关于")}
      </h3>
      <div className="rounded-lg border border-hairline bg-surface p-md text-body-sm text-body dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark-soft">
        <span className="font-semibold text-ink dark:text-on-dark">Google Todo v0.1.10</span>
        {t(
          language,
          ". A Google Tasks and Google Calendar desktop client built with Tauri, React, TypeScript, and Tailwind CSS.",
          "。一个使用 Tauri、React、TypeScript 和 Tailwind CSS 构建的 Google Tasks 和 Google Calendar 桌面客户端。",
        )}
      </div>
    </section>
  );
}
