"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type BarPoint = {
  time: string;
  c: number;
};

type Props = {
  data: BarPoint[];
};

export function TickerChart({ data }: Props) {
  if (!data.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>;
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <XAxis dataKey="time" minTickGap={40} tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => v.toFixed(2)} width={60} tick={{ fontSize: 12 }} />
          <Tooltip labelFormatter={(v) => v} formatter={(value: number) => value.toFixed(2)} />
          <Line
            type="monotone"
            dataKey="c"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
