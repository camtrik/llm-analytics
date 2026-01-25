import {
  BarChart2,
  Brain,
  ChartCandlestick,
  ClipboardList,
  Compass,
  LineChart,
  ListChecks,
  type LucideIcon,
  Settings2,
  Waypoints,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Data",
    items: [
      {
        title: "Tickers",
        url: "/dashboard/tickers",
        icon: ChartCandlestick,
      },
      {
        title: "Portfolio",
        url: "/dashboard/portfolio",
        icon: ClipboardList,
      },
    ],
  },
  {
    id: 2,
    label: "Strategies",
    items: [
      {
        title: "Strategy Hub",
        url: "/dashboard/strategy",
        icon: Compass,
      },
      {
        title: "Low-Volume Pullback",
        url: "/dashboard/strategy/low-volume-pullback",
        icon: ListChecks,
      },
    ],
  },
  {
    id: 3,
    label: "LLM",
    items: [
      {
        title: "Analysis",
        url: "/dashboard/analysis",
        icon: Brain,
      },
      {
        title: "Quant",
        url: "/dashboard/coming-soon",
        icon: BarChart2,
        comingSoon: true,
      },
      {
        title: "Settings",
        url: "/dashboard/coming-soon",
        icon: Settings2,
        comingSoon: true,
      },
    ],
  },
];
