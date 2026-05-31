import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/classNames";
import { IconButton } from "./IconButton";

type ModalProps = {
  title?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function Modal({ title, open, onClose, children, className }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/25 p-lg backdrop-blur-sm">
      <div
        className={cn(
          "max-h-[88vh] w-full overflow-hidden rounded-xl border border-hairline bg-canvas shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark",
          className,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-hairline bg-surface-soft px-lg py-md dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
            <h2 className="font-display text-title-lg text-ink dark:text-on-dark">{title}</h2>
            <IconButton label="关闭" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
