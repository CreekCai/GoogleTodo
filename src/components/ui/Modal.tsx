import { useEffect, useId, type ReactNode } from "react";
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
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-primary/25 p-lg backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "app-modal-panel max-h-[88vh] w-full overflow-hidden rounded-xl border border-hairline bg-canvas shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark",
          className,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-hairline bg-surface-soft px-lg py-md dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
            <h2 id={titleId} className="font-display text-title-lg text-ink dark:text-on-dark">{title}</h2>
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
