import { Trash2 } from "lucide-react";
import { Button } from "../ui/Button";

type DeleteTaskButtonProps = {
  onDelete: () => void;
};

export function DeleteTaskButton({ onDelete }: DeleteTaskButtonProps) {
  return (
    <Button variant="danger" className="w-full" onClick={onDelete}>
      <Trash2 size={18} />
      Delete Task
    </Button>
  );
}
