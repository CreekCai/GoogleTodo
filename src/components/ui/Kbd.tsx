import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-hairline bg-surface-card px-xs py-1 font-code text-caption text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark-soft">
      {children}
    </kbd>
  );
}
