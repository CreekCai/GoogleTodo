import { Check } from "lucide-react";
import { cn } from "../../lib/classNames";

type CompletionToggleProps = {
  checked: boolean;
  onClick: () => void;
  size?: "sm" | "md";
};

export function CompletionToggle({ checked, onClick, size = "md" }: CompletionToggleProps) {
  return (
    <button
      className={cn(
        "grid shrink-0 place-items-center rounded border transition-colors",
        size === "md" ? "h-5 w-5" : "h-4 w-4",
        checked
          ? "border-success bg-success text-on-dark"
          : "border-outline text-transparent hover:border-primary dark:border-outline-variant dark:hover:border-on-dark",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {checked ? <Check size={size === "md" ? 14 : 11} /> : null}
    </button>
  );
}
