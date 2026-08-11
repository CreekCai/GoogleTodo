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
        "app-focus-ring inline-grid h-9 w-9 select-none place-items-center rounded-full text-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-surface-soft hover:text-ink active:scale-[0.92] disabled:scale-100 dark:text-on-dark-soft dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
