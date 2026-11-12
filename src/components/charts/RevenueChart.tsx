"use client";

import * as React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface RevenueChartDataPoint {
  day: string;
  sales: number;
  collections: number;
}

interface RevenueChartProps {
  data?: RevenueChartDataPoint[];
}

export function RevenueChart({ data = [] }: RevenueChartProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-[280px] w-full flex items-center justify-center bg-muted/20 rounded-lg animate-pulse text-xs text-muted-foreground">
        Loading chart visualization...
      </div>
    );
  }

  const chartData = data && data.length > 0 ? data : [
    { day: "Mon", sales: 0, collections: 0 },
    { day: "Tue", sales: 0, collections: 0 },
    { day: "Wed", sales: 0, collections: 0 },
    { day: "Thu", sales: 0, collections: 0 },
    { day: "Fri", sales: 0, collections: 0 },
    { day: "Sat", sales: 0, collections: 0 },
    { day: "Sun", sales: 0, collections: 0 },
  ];

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="colorCollections" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#64748b" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(value) => `₹${value >= 1000 ? `${value / 1000}k` : value}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              borderColor: "#e2e8f0",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              fontSize: "12px",
            }}
            formatter={(value: number) => [`₹${Number(value || 0).toLocaleString("en-IN")}`, undefined]}
          />
          <Area
            type="monotone"
            dataKey="sales"
            name="Invoiced Sales"
            stroke="#1e3a8a"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorSales)"
          />
          <Area
            type="monotone"
            dataKey="collections"
            name="Cash/Bank Collections"
            stroke="#0ea5e9"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorCollections)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
