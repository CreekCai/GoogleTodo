import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/classNames";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
};

export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-soft hover:text-ink dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
