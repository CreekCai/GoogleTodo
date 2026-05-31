type TaskTitleEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

export function TaskTitleEditor({ value, onChange, onBlur }: TaskTitleEditorProps) {
  return (
    <textarea
      className="min-h-[72px] w-full resize-none border-none bg-transparent p-0 font-display text-title-lg text-ink outline-none placeholder:text-muted-soft focus:ring-0 dark:text-on-dark"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder="Task title"
      rows={2}
    />
  );
}
