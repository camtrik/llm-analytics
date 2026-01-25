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
  titleKey?: string;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
  titleKey?: string;
}

export interface NavGroup {
  id: number;
  label?: string;
  labelKey?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Data",
    labelKey: "nav.group.data",
    items: [
      {
        title: "Tickers",
        url: "/dashboard/tickers",
        icon: ChartCandlestick,
        titleKey: "nav.tickers",
      },
      {
        title: "Portfolio",
        url: "/dashboard/portfolio",
        icon: ClipboardList,
        titleKey: "nav.portfolio",
      },
    ],
  },
  {
    id: 2,
    label: "Strategies",
    labelKey: "nav.group.strategies",
    items: [
      {
        title: "Strategy Hub",
        url: "/dashboard/strategy",
        icon: Compass,
        titleKey: "nav.strategyHub",
      },
      {
        title: "Low-Volume Pullback",
        url: "/dashboard/strategy/low-volume-pullback",
        icon: ListChecks,
        titleKey: "nav.lowVolume",
      },
    ],
  },
  {
    id: 3,
    label: "LLM",
    labelKey: "nav.group.llm",
    items: [
      {
        title: "Analysis",
        url: "/dashboard/analysis",
        icon: Brain,
        titleKey: "nav.analysis",
      },
      {
        title: "Quant",
        url: "/dashboard/coming-soon",
        icon: BarChart2,
        comingSoon: true,
        titleKey: "nav.quant",
      },
      {
        title: "Settings",
        url: "/dashboard/coming-soon",
        icon: Settings2,
        comingSoon: true,
        titleKey: "nav.settings",
      },
    ],
  },
];
