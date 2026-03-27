import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sun, Moon, Monitor, Settings2, Check, RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Color theme definitions — full shadcn/ui CSS variable set          */
/* ------------------------------------------------------------------ */

interface ColorTheme {
  name: string;
  label: string;
  activeColor: string;
  cssVars: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
}

const colorThemes: ColorTheme[] = [
  {
    name: "zinc",
    label: "Zinc",
    activeColor: "hsl(240 5.9% 10%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "240 10% 3.9%",
        "--card": "0 0% 100%",
        "--card-foreground": "240 10% 3.9%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "240 10% 3.9%",
        "--primary": "240 5.9% 10%",
        "--primary-foreground": "0 0% 98%",
        "--secondary": "240 4.8% 95.9%",
        "--secondary-foreground": "240 5.9% 10%",
        "--muted": "240 4.8% 95.9%",
        "--muted-foreground": "240 3.8% 46.1%",
        "--accent": "240 4.8% 95.9%",
        "--accent-foreground": "240 5.9% 10%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "240 5.9% 90%",
        "--input": "240 5.9% 90%",
        "--ring": "240 5.9% 10%",
      },
      dark: {
        "--background": "240 10% 3.9%",
        "--foreground": "0 0% 98%",
        "--card": "240 10% 3.9%",
        "--card-foreground": "0 0% 98%",
        "--popover": "240 10% 3.9%",
        "--popover-foreground": "0 0% 98%",
        "--primary": "0 0% 98%",
        "--primary-foreground": "240 5.9% 10%",
        "--secondary": "240 3.7% 15.9%",
        "--secondary-foreground": "0 0% 98%",
        "--muted": "240 3.7% 15.9%",
        "--muted-foreground": "240 5% 64.9%",
        "--accent": "240 3.7% 15.9%",
        "--accent-foreground": "0 0% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "240 3.7% 15.9%",
        "--input": "240 3.7% 15.9%",
        "--ring": "240 4.9% 83.9%",
      },
    },
  },
  {
    name: "slate",
    label: "Slate",
    activeColor: "hsl(215.4 16.3% 46.9%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "222.2 84% 4.9%",
        "--card": "0 0% 100%",
        "--card-foreground": "222.2 84% 4.9%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "222.2 84% 4.9%",
        "--primary": "222.2 47.4% 11.2%",
        "--primary-foreground": "210 40% 98%",
        "--secondary": "210 40% 96.1%",
        "--secondary-foreground": "222.2 47.4% 11.2%",
        "--muted": "210 40% 96.1%",
        "--muted-foreground": "215.4 16.3% 46.9%",
        "--accent": "210 40% 96.1%",
        "--accent-foreground": "222.2 47.4% 11.2%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "210 40% 98%",
        "--border": "214.3 31.8% 91.4%",
        "--input": "214.3 31.8% 91.4%",
        "--ring": "222.2 84% 4.9%",
      },
      dark: {
        "--background": "222.2 84% 4.9%",
        "--foreground": "210 40% 98%",
        "--card": "222.2 84% 4.9%",
        "--card-foreground": "210 40% 98%",
        "--popover": "222.2 84% 4.9%",
        "--popover-foreground": "210 40% 98%",
        "--primary": "210 40% 98%",
        "--primary-foreground": "222.2 47.4% 11.2%",
        "--secondary": "217.2 32.6% 17.5%",
        "--secondary-foreground": "210 40% 98%",
        "--muted": "217.2 32.6% 17.5%",
        "--muted-foreground": "215 20.2% 65.1%",
        "--accent": "217.2 32.6% 17.5%",
        "--accent-foreground": "210 40% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "210 40% 98%",
        "--border": "217.2 32.6% 17.5%",
        "--input": "217.2 32.6% 17.5%",
        "--ring": "212.7 26.8% 83.9%",
      },
    },
  },
  {
    name: "violet",
    label: "Violet",
    activeColor: "hsl(263 70% 50.4%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "224 71.4% 4.1%",
        "--card": "0 0% 100%",
        "--card-foreground": "224 71.4% 4.1%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "224 71.4% 4.1%",
        "--primary": "262.1 83.3% 57.8%",
        "--primary-foreground": "210 20% 98%",
        "--secondary": "220 14.3% 95.9%",
        "--secondary-foreground": "220.9 39.3% 11%",
        "--muted": "220 14.3% 95.9%",
        "--muted-foreground": "220 8.9% 46.1%",
        "--accent": "220 14.3% 95.9%",
        "--accent-foreground": "220.9 39.3% 11%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "210 20% 98%",
        "--border": "220 13% 91%",
        "--input": "220 13% 91%",
        "--ring": "262.1 83.3% 57.8%",
      },
      dark: {
        "--background": "224 71.4% 4.1%",
        "--foreground": "210 20% 98%",
        "--card": "224 71.4% 4.1%",
        "--card-foreground": "210 20% 98%",
        "--popover": "224 71.4% 4.1%",
        "--popover-foreground": "210 20% 98%",
        "--primary": "263.4 70% 50.4%",
        "--primary-foreground": "210 20% 98%",
        "--secondary": "215 27.9% 16.9%",
        "--secondary-foreground": "210 20% 98%",
        "--muted": "215 27.9% 16.9%",
        "--muted-foreground": "217.9 10.6% 64.9%",
        "--accent": "215 27.9% 16.9%",
        "--accent-foreground": "210 20% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "210 20% 98%",
        "--border": "215 27.9% 16.9%",
        "--input": "215 27.9% 16.9%",
        "--ring": "263.4 70% 50.4%",
      },
    },
  },
  {
    name: "blue",
    label: "Blue",
    activeColor: "hsl(221.2 83.2% 53.3%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "222.2 84% 4.9%",
        "--card": "0 0% 100%",
        "--card-foreground": "222.2 84% 4.9%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "222.2 84% 4.9%",
        "--primary": "221.2 83.2% 53.3%",
        "--primary-foreground": "210 40% 98%",
        "--secondary": "210 40% 96.1%",
        "--secondary-foreground": "222.2 47.4% 11.2%",
        "--muted": "210 40% 96.1%",
        "--muted-foreground": "215.4 16.3% 46.9%",
        "--accent": "210 40% 96.1%",
        "--accent-foreground": "222.2 47.4% 11.2%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "210 40% 98%",
        "--border": "214.3 31.8% 91.4%",
        "--input": "214.3 31.8% 91.4%",
        "--ring": "221.2 83.2% 53.3%",
      },
      dark: {
        "--background": "222.2 84% 4.9%",
        "--foreground": "210 40% 98%",
        "--card": "222.2 84% 4.9%",
        "--card-foreground": "210 40% 98%",
        "--popover": "222.2 84% 4.9%",
        "--popover-foreground": "210 40% 98%",
        "--primary": "217.2 91.2% 59.8%",
        "--primary-foreground": "222.2 47.4% 11.2%",
        "--secondary": "217.2 32.6% 17.5%",
        "--secondary-foreground": "210 40% 98%",
        "--muted": "217.2 32.6% 17.5%",
        "--muted-foreground": "215 20.2% 65.1%",
        "--accent": "217.2 32.6% 17.5%",
        "--accent-foreground": "210 40% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "210 40% 98%",
        "--border": "217.2 32.6% 17.5%",
        "--input": "217.2 32.6% 17.5%",
        "--ring": "224.3 76.3% 48%",
      },
    },
  },
  {
    name: "green",
    label: "Green",
    activeColor: "hsl(142.1 76.2% 36.3%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "240 10% 3.9%",
        "--card": "0 0% 100%",
        "--card-foreground": "240 10% 3.9%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "240 10% 3.9%",
        "--primary": "142.1 76.2% 36.3%",
        "--primary-foreground": "355.7 100% 97.3%",
        "--secondary": "240 4.8% 95.9%",
        "--secondary-foreground": "240 5.9% 10%",
        "--muted": "240 4.8% 95.9%",
        "--muted-foreground": "240 3.8% 46.1%",
        "--accent": "240 4.8% 95.9%",
        "--accent-foreground": "240 5.9% 10%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "240 5.9% 90%",
        "--input": "240 5.9% 90%",
        "--ring": "142.1 76.2% 36.3%",
      },
      dark: {
        "--background": "20 14.3% 4.1%",
        "--foreground": "0 0% 95%",
        "--card": "24 9.8% 10%",
        "--card-foreground": "0 0% 95%",
        "--popover": "0 0% 9%",
        "--popover-foreground": "0 0% 95%",
        "--primary": "142.1 70.6% 45.3%",
        "--primary-foreground": "144.9 80.4% 10%",
        "--secondary": "240 3.7% 15.9%",
        "--secondary-foreground": "0 0% 98%",
        "--muted": "0 0% 15%",
        "--muted-foreground": "240 5% 64.9%",
        "--accent": "12 6.5% 15.1%",
        "--accent-foreground": "0 0% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "0 85.7% 97.3%",
        "--border": "240 3.7% 15.9%",
        "--input": "240 3.7% 15.9%",
        "--ring": "142.4 71.8% 29.2%",
      },
    },
  },
  {
    name: "rose",
    label: "Rose",
    activeColor: "hsl(346.8 77.2% 49.8%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "240 10% 3.9%",
        "--card": "0 0% 100%",
        "--card-foreground": "240 10% 3.9%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "240 10% 3.9%",
        "--primary": "346.8 77.2% 49.8%",
        "--primary-foreground": "355.7 100% 97.3%",
        "--secondary": "240 4.8% 95.9%",
        "--secondary-foreground": "240 5.9% 10%",
        "--muted": "240 4.8% 95.9%",
        "--muted-foreground": "240 3.8% 46.1%",
        "--accent": "240 4.8% 95.9%",
        "--accent-foreground": "240 5.9% 10%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "240 5.9% 90%",
        "--input": "240 5.9% 90%",
        "--ring": "346.8 77.2% 49.8%",
      },
      dark: {
        "--background": "20 14.3% 4.1%",
        "--foreground": "0 0% 95%",
        "--card": "24 9.8% 10%",
        "--card-foreground": "0 0% 95%",
        "--popover": "0 0% 9%",
        "--popover-foreground": "0 0% 95%",
        "--primary": "346.8 77.2% 49.8%",
        "--primary-foreground": "355.7 100% 97.3%",
        "--secondary": "240 3.7% 15.9%",
        "--secondary-foreground": "0 0% 98%",
        "--muted": "0 0% 15%",
        "--muted-foreground": "240 5% 64.9%",
        "--accent": "12 6.5% 15.1%",
        "--accent-foreground": "0 0% 98%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "0 85.7% 97.3%",
        "--border": "240 3.7% 15.9%",
        "--input": "240 3.7% 15.9%",
        "--ring": "346.8 77.2% 49.8%",
      },
    },
  },
  {
    name: "orange",
    label: "Orange",
    activeColor: "hsl(24.6 95% 53.1%)",
    cssVars: {
      light: {
        "--background": "0 0% 100%",
        "--foreground": "20 14.3% 4.1%",
        "--card": "0 0% 100%",
        "--card-foreground": "20 14.3% 4.1%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "20 14.3% 4.1%",
        "--primary": "24.6 95% 53.1%",
        "--primary-foreground": "60 9.1% 97.8%",
        "--secondary": "60 4.8% 95.9%",
        "--secondary-foreground": "24 9.8% 10%",
        "--muted": "60 4.8% 95.9%",
        "--muted-foreground": "25 5.3% 44.7%",
        "--accent": "60 4.8% 95.9%",
        "--accent-foreground": "24 9.8% 10%",
        "--destructive": "0 84.2% 60.2%",
        "--destructive-foreground": "60 9.1% 97.8%",
        "--border": "20 5.9% 90%",
        "--input": "20 5.9% 90%",
        "--ring": "24.6 95% 53.1%",
      },
      dark: {
        "--background": "20 14.3% 4.1%",
        "--foreground": "60 9.1% 97.8%",
        "--card": "20 14.3% 4.1%",
        "--card-foreground": "60 9.1% 97.8%",
        "--popover": "20 14.3% 4.1%",
        "--popover-foreground": "60 9.1% 97.8%",
        "--primary": "20.5 90.2% 48.2%",
        "--primary-foreground": "60 9.1% 97.8%",
        "--secondary": "12 6.5% 15.1%",
        "--secondary-foreground": "60 9.1% 97.8%",
        "--muted": "12 6.5% 15.1%",
        "--muted-foreground": "24 5.4% 63.9%",
        "--accent": "12 6.5% 15.1%",
        "--accent-foreground": "60 9.1% 97.8%",
        "--destructive": "0 62.8% 30.6%",
        "--destructive-foreground": "60 9.1% 97.8%",
        "--border": "12 6.5% 15.1%",
        "--input": "12 6.5% 15.1%",
        "--ring": "20.5 90.2% 48.2%",
      },
    },
  },
];

const radiusOptions = [0, 0.3, 0.5, 0.75, 1.0];

/* ------------------------------------------------------------------ */
/*  Theme Config Context                                               */
/* ------------------------------------------------------------------ */

interface ThemeConfig {
  color: string;
  radius: number;
}

interface ThemeConfigContextValue {
  config: ThemeConfig;
  setColor: (color: string) => void;
  setRadius: (radius: number) => void;
  reset: () => void;
}

const defaultConfig: ThemeConfig = { color: "zinc", radius: 0.5 };

const ThemeConfigContext = createContext<ThemeConfigContextValue>({
  config: defaultConfig,
  setColor: () => {},
  setRadius: () => {},
  reset: () => {},
});

export function useThemeConfig() {
  return useContext(ThemeConfigContext);
}

export function ThemeConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>(() => {
    const saved = localStorage.getItem("theme-config");
    if (saved) {
      try {
        return { ...defaultConfig, ...JSON.parse(saved) };
      } catch {
        return defaultConfig;
      }
    }
    return defaultConfig;
  });

  const applyConfig = useCallback((cfg: ThemeConfig) => {
    const root = document.documentElement;

    root.style.setProperty("--radius", `${cfg.radius}rem`);

    const theme = colorThemes.find((t) => t.name === cfg.color);
    if (theme) {
      const isDark = root.classList.contains("dark");
      const vars = isDark ? theme.cssVars.dark : theme.cssVars.light;
      for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
      }
    }
  }, []);

  useEffect(() => {
    applyConfig(config);
    localStorage.setItem("theme-config", JSON.stringify(config));
  }, [config, applyConfig]);

  // Re-apply when dark/light mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      applyConfig(config);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [config, applyConfig]);

  const setColor = (color: string) => setConfig((prev) => ({ ...prev, color }));
  const setRadius = (radius: number) => setConfig((prev) => ({ ...prev, radius }));
  const reset = () => setConfig(defaultConfig);

  return (
    <ThemeConfigContext.Provider value={{ config, setColor, setRadius, reset }}>
      {children}
    </ThemeConfigContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme Customizer Component                                         */
/* ------------------------------------------------------------------ */

export function ThemeCustomizer() {
  const { theme, setTheme } = useTheme();
  const { config, setColor, setRadius, reset } = useThemeConfig();

  const modeOptions: { value: "light" | "dark" | "system"; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun size={14} />, label: "浅色" },
    { value: "dark", icon: <Moon size={14} />, label: "深色" },
    { value: "system", icon: <Monitor size={14} />, label: "系统" },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
          <Settings2 size={16} />
          <span className="sr-only">主题设置</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" sideOffset={8}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">主题设置</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={reset}>
            <RotateCcw size={12} />
            重置
          </Button>
        </div>

        <div className="space-y-1.5 mb-4">
          <Label className="text-xs text-muted-foreground">主题色</Label>
          <div className="grid grid-cols-7 gap-1.5">
            {colorThemes.map((t) => {
              const isActive = config.color === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => setColor(t.name)}
                  className="group relative flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors hover:border-foreground/40"
                  style={isActive ? { borderColor: t.activeColor } : undefined}
                  title={t.label}
                >
                  <span
                    className="h-5 w-5 rounded-sm"
                    style={{ backgroundColor: t.activeColor }}
                  />
                  {isActive && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Check size={12} className="text-white drop-shadow-sm" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5 mb-4">
          <Label className="text-xs text-muted-foreground">圆角</Label>
          <div className="flex gap-1.5">
            {radiusOptions.map((r) => {
              const isActive = config.radius === r;
              return (
                <button
                  key={r}
                  onClick={() => setRadius(r)}
                  className={`flex-1 h-8 rounded-md border text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-background text-foreground hover:bg-accent"
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        <Separator className="my-3" />

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">外观模式</Label>
          <div className="flex gap-1.5">
            {modeOptions.map((opt) => {
              const isActive = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md border text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-background text-foreground hover:bg-accent"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
