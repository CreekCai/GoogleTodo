import { Plus, CornerDownLeft } from "lucide-react";
import { Button } from "../ui/Button";

type NewTaskInputProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function NewTaskInput({ value, placeholder, onChange, onSubmit }: NewTaskInputProps) {
  return (
    <form
      className="group flex items-center gap-md rounded-lg border border-hairline bg-surface-card p-sm transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-within:border-outline focus-within:bg-canvas focus-within:ring-1 focus-within:ring-outline dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:focus-within:border-on-dark dark:focus-within:ring-on-dark"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Plus className="text-muted" size={22} />
      <input
        className="min-w-0 flex-1 border-none bg-transparent p-0 text-body-md text-ink outline-none placeholder:text-muted focus:ring-0 dark:text-on-dark"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <Button className="h-9 px-sm" type="submit" disabled={!value.trim()}>
        <CornerDownLeft size={17} />
        Add
      </Button>
    </form>
  );
}
