import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/classNames";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-dark hover:bg-primary-active dark:bg-primary dark:text-on-dark dark:hover:bg-primary-active",
  secondary:
    "border border-hairline bg-canvas text-ink hover:bg-surface-soft dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark dark:hover:bg-surface-dark-elevated",
  ghost:
    "text-muted hover:bg-surface-soft hover:text-ink dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark",
  danger:
    "text-error hover:bg-error-container/40 dark:hover:bg-error/10",
};

export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "app-focus-ring inline-flex h-10 select-none items-center justify-center gap-xs rounded-lg px-md text-button transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:scale-100 disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
