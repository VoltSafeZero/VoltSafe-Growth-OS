import { useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortState = {
  sortBy: string | null;
  sortOrder: "asc" | "desc";
};

export function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const isActive = sort.sortBy === sortKey;

  return (
    <th
      className={`p-4 text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"} ${className}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-${sortKey}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sort.sortOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </span>
    </th>
  );
}

export function useSortState(defaultKey: string | null = null, defaultOrder: "asc" | "desc" = "desc") {
  const [sort, setSort] = useState<SortState>({ sortBy: defaultKey, sortOrder: defaultOrder });

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (prev.sortBy === key) {
        return { sortBy: key, sortOrder: prev.sortOrder === "asc" ? "desc" : "asc" };
      }
      return { sortBy: key, sortOrder: "asc" };
    });
  };

  return { sort, handleSort };
}
