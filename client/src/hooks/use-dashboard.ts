import { useQuery } from "@tanstack/react-query";
import type { Metric, Sale, ChartData } from "@shared/schema";

export function useMetrics() {
  return useQuery<Metric[]>({
    queryKey: ["/api/metrics"],
  });
}

export function useSales() {
  return useQuery<Sale[]>({
    queryKey: ["/api/sales"],
  });
}

export function useChartData() {
  return useQuery<ChartData[]>({
    queryKey: ["/api/chart-data"],
  });
}
