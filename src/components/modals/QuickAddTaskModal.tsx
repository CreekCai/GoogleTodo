import { CalendarDays, FileText, Inbox, Timer } from "lucide-react";
import type { QuickTaskDraft, SmartView, TaskListSummary } from "../../types";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";

type QuickAddTaskModalProps = {
  open: boolean;
  draft: QuickTaskDraft;
  lists: TaskListSummary[];
  onDraftChange: (draft: QuickTaskDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const dueOptions: Array<{ value: SmartView; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "all", label: "No date" },
];

export function QuickAddTaskModal({
  open,
  draft,
  lists,
  onDraftChange,
  onClose,
  onSubmit,
}: QuickAddTaskModalProps) {
  if (!open) {
    return null;
  }

  const patchDraft = (patch: Partial<QuickTaskDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-surface-dark/90 p-lg backdrop-blur-md">
      <form
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-dark-elevated text-on-dark shadow-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      >
        <div className="border-b border-outline-variant/20 p-xl">
          <input
            autoFocus
            className="w-full border-none bg-transparent p-0 font-display text-display-sm text-on-dark outline-none placeholder:text-muted focus:ring-0"
            value={draft.title}
            onChange={(event) => patchDraft({ title: event.target.value })}
            placeholder="What needs to be done?"
          />
        </div>

        <div className="flex flex-wrap items-center gap-md border-b border-outline-variant/10 px-xl py-lg">
          <label className="inline-flex items-center gap-xs rounded border border-outline-variant/20 bg-surface-dark px-sm py-xs text-body-sm text-on-dark-soft">
            <Inbox size={16} />
            <select
              className="border-none bg-transparent p-0 text-on-dark-soft outline-none focus:ring-0"
              value={draft.listId}
              onChange={(event) => patchDraft({ listId: event.target.value })}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-xs rounded border border-outline-variant/20 bg-surface-dark px-sm py-xs text-body-sm text-on-dark-soft">
            <CalendarDays size={16} />
            <select
              className="border-none bg-transparent p-0 text-on-dark-soft outline-none focus:ring-0"
              value={draft.dueLabel}
              onChange={(event) => patchDraft({ dueLabel: event.target.value as SmartView })}
            >
              {dueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-xs rounded border border-outline-variant/20 bg-surface-dark px-sm py-xs text-body-sm text-on-dark-soft">
            <Timer size={16} />
            <input
              className="w-16 border-none bg-transparent p-0 text-on-dark-soft outline-none placeholder:text-muted focus:ring-0"
              value={draft.estimate}
              onChange={(event) => patchDraft({ estimate: event.target.value })}
              placeholder="30m"
            />
          </label>

          <span className="ml-auto inline-flex items-center gap-xs rounded border border-outline-variant/20 bg-surface-dark px-sm py-xs text-body-sm text-on-dark-soft">
            <FileText size={16} />
            Add Note
          </span>
        </div>

        <div className="border-b border-outline-variant/10 bg-surface-dark px-xl py-md">
          <textarea
            className="h-16 w-full resize-none border-none bg-transparent p-0 text-body-sm text-on-dark-soft outline-none placeholder:text-muted focus:ring-0"
            value={draft.notes}
            onChange={(event) => patchDraft({ notes: event.target.value })}
            placeholder="Add a description or context..."
          />
        </div>

        <div className="flex items-center justify-between px-xl py-md">
          <div className="flex items-center gap-sm text-body-sm text-muted">
            <span>Press</span>
            <Kbd>Esc</Kbd>
            <span>to cancel</span>
          </div>
          <div className="flex items-center gap-md">
            <div className="hidden items-center gap-sm text-body-sm text-muted sm:flex">
              <span>Press</span>
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd>
            </div>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create Task</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
