import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserOption = { id: number; name: string; email: string };

export function AssignUserSelect({
  value,
  onValueChange,
  label,
  testId,
}: {
  value: number | null | undefined;
  onValueChange: (userId: number | null) => void;
  label?: string;
  testId?: string;
}) {
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
  });

  return (
    <Select
      value={value ? String(value) : "unassigned"}
      onValueChange={(v) => onValueChange(v === "unassigned" ? null : Number(v))}
    >
      <SelectTrigger data-testid={testId || "select-assign-user"}>
        <SelectValue placeholder={label || "Assign to..."} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={String(u.id)}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
