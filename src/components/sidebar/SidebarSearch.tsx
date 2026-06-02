import { Search } from "lucide-react";

type SidebarSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  return (
    <label className="relative block">
      <Search className="absolute left-sm top-1/2 -translate-y-1/2 text-muted-soft" size={18} />
      <input
        className="h-11 w-full rounded bg-surface-soft pl-xl pr-sm text-body-sm text-ink outline-none transition-colors placeholder:text-muted-soft focus:ring-1 focus:ring-primary dark:bg-surface-dark-elevated dark:text-on-dark dark:focus:ring-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search tasks..."
      />
    </label>
  );
}
