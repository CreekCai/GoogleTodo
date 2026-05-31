type TaskNotesEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

export function TaskNotesEditor({ value, onChange, onBlur }: TaskNotesEditorProps) {
  return (
    <textarea
      className="min-h-[120px] w-full resize-none rounded-lg border border-transparent bg-surface-soft p-md text-body-sm text-ink outline-none transition-colors placeholder:text-muted-soft focus:border-hairline focus:ring-0 dark:bg-surface-dark-elevated dark:text-on-dark dark:focus:border-surface-tint"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder="Add notes..."
    />
  );
}
