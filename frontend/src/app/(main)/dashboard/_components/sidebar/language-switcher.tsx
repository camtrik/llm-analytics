"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Locale } from "@/i18n/config";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();

  const applyLocale = (value: Locale) => {
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000`;
    router.replace(pathname);
    router.refresh();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" aria-label="Language">
          <Globe className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 space-y-2">
        <div className="text-sm font-medium">Language</div>
        <div className="grid gap-1.5">
          {OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={opt.value === locale ? "default" : "outline"}
              className="justify-start"
              onClick={() => applyLocale(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
