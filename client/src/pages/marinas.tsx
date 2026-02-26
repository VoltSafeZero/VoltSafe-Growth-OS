import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MapPin, Phone, Loader2, Anchor } from "lucide-react";
import { SortableHeader, useSortState } from "@/components/ui/sortable-header";
import type { Marina } from "@shared/schema";

export default function MarinasPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [state, setState] = useState<string>("");
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const { sort, handleSort } = useSortState();

  const { data: states } = useQuery<string[]>({
    queryKey: ["/api/marinas/states"],
  });

  const PAGE_SIZE = 100;
  const { data: result, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{
    data: Marina[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ["/api/marinas", debouncedSearch, state, sort.sortBy, sort.sortOrder],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (state && state !== "all") params.set("state", state);
      if (sort.sortBy) { params.set("sortBy", sort.sortBy); params.set("sortOrder", sort.sortOrder); }
      params.set("page", String(pageParam));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/marinas?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch marinas");
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

  const allMarinas = result?.pages.flatMap(p => p.data) || [];
  const totalCount = result?.pages[0]?.total || 0;

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(val);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const handleStateChange = (val: string) => {
    setState(val);
  };

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8 pt-6 max-w-7xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-marinas-title">Marinas</h1>
          <p className="text-muted-foreground mt-1">
            {totalCount > 0 ? `${totalCount.toLocaleString()} marinas across the USA` : "Loading..."}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-marina-search"
            placeholder="Search by name, city, or state..."
            className="pl-9"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Select value={state} onValueChange={handleStateChange}>
          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-state-filter">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            {states?.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/50 shadow-sm bg-card/50 backdrop-blur-sm">
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b border-border">
                <SortableHeader label="Name" sortKey="name" sort={sort} onSort={handleSort} />
                <SortableHeader label="Location" sortKey="state" sort={sort} onSort={handleSort} />
                <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Phone</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Address</th>
                <SortableHeader label="Slips" sortKey="slips" sort={sort} onSort={handleSort} className="hidden sm:table-cell" />
              </tr>
            </thead>
            <TableBody>
              {isLoading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-12" /></TableCell>
                  </TableRow>
                ))
              ) : allMarinas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No marinas found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                allMarinas.map((marina) => (
                  <TableRow key={marina.id} data-testid={`row-marina-${marina.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Anchor className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate max-w-[200px]">{marina.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm">{marina.city}, {marina.state}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {marina.phone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm">{marina.phone}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {marina.streetAddress ? (
                        <span className="text-sm truncate max-w-[250px] block">{marina.streetAddress}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {marina.slips ? (
                        <Badge variant="secondary" className="no-default-active-elevate">{marina.slips === "-" ? "Unknown" : marina.slips}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground" data-testid="text-pagination-info">
          {allMarinas.length.toLocaleString()} of {totalCount.toLocaleString()} marinas loaded
        </p>
        {isFetchingNextPage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</div>
        )}
      </div>
      <div ref={scrollSentinelRef} className="h-4" />
    </div>
  );
}
