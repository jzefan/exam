import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sun, Moon, Monitor, Settings2, RotateCcw, Maximize, AlignCenter } from "lucide-react";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Color theme definitions                                            */
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
  { name: "zinc", label: "锌灰", activeColor: "hsl(240 5.9% 10%)", cssVars: { 
    light: { "--primary": "240 5.9% 10%", "--primary-foreground": "0 0% 98%", "--ring": "240 5.9% 10%", "--accent": "240 4.8% 95.9%", "--accent-foreground": "240 5.9% 10%" },
    dark: { "--primary": "0 0% 98%", "--primary-foreground": "240 5.9% 10%", "--ring": "240 4.9% 83.9%", "--accent": "240 3.7% 15.9%", "--accent-foreground": "0 0% 98%" }
  }},
  { name: "red", label: "红色", activeColor: "hsl(0 72.2% 50.6%)", cssVars: { 
    light: { "--primary": "0 72.2% 50.6%", "--primary-foreground": "0 85.7% 97.3%", "--ring": "0 72.2% 50.6%", "--accent": "0 72.2% 96%", "--accent-foreground": "0 72.2% 50.6%" },
    dark: { "--primary": "0 72.2% 50.6%", "--primary-foreground": "0 85.7% 97.3%", "--ring": "0 72.2% 50.6%", "--accent": "0 72.2% 15%", "--accent-foreground": "0 85.7% 97.3%" }
  }},
  { name: "rose", label: "玫瑰", activeColor: "hsl(346.8 77.2% 49.8%)", cssVars: { 
    light: { "--primary": "346.8 77.2% 49.8%", "--primary-foreground": "355.7 100% 97.3%", "--ring": "346.8 77.2% 49.8%", "--accent": "346.8 77.2% 96%", "--accent-foreground": "346.8 77.2% 49.8%" },
    dark: { "--primary": "346.8 77.2% 49.8%", "--primary-foreground": "355.7 100% 97.3%", "--ring": "346.8 77.2% 49.8%", "--accent": "346.8 77.2% 15%", "--accent-foreground": "355.7 100% 97.3%" }
  }},
  { name: "orange", label: "橙色", activeColor: "hsl(24.6 95% 53.1%)", cssVars: { 
    light: { "--primary": "24.6 95% 53.1%", "--primary-foreground": "60 9.1% 97.8%", "--ring": "24.6 95% 53.1%", "--accent": "24.6 95% 96%", "--accent-foreground": "24.6 95% 53.1%" },
    dark: { "--primary": "20.5 90.2% 48.2%", "--primary-foreground": "60 9.1% 97.8%", "--ring": "20.5 90.2% 48.2%", "--accent": "20.5 90.2% 15%", "--accent-foreground": "60 9.1% 97.8%" }
  }},
  { name: "green", label: "绿色", activeColor: "hsl(142.1 76.2% 36.3%)", cssVars: { 
    light: { "--primary": "142.1 76.2% 36.3%", "--primary-foreground": "355.7 100% 97.3%", "--ring": "142.1 76.2% 36.3%", "--accent": "142.1 76.2% 96%", "--accent-foreground": "142.1 76.2% 36.3%" },
    dark: { "--primary": "142.1 70.6% 45.3%", "--primary-foreground": "144.9 80.4% 10%", "--ring": "142.4 71.8% 29.2%", "--accent": "142.1 70.6% 15%", "--accent-foreground": "144.9 80.4% 10%" }
  }},
  { name: "blue", label: "蓝色", activeColor: "hsl(221.2 83.2% 53.3%)", cssVars: { 
    light: { "--primary": "221.2 83.2% 53.3%", "--primary-foreground": "210 40% 98%", "--ring": "221.2 83.2% 53.3%", "--accent": "221.2 83.2% 96%", "--accent-foreground": "221.2 83.2% 53.3%" },
    dark: { "--primary": "217.2 91.2% 59.8%", "--primary-foreground": "222.2 47.4% 11.2%", "--ring": "224.3 76.3% 48%", "--accent": "217.2 91.2% 15%", "--accent-foreground": "222.2 47.4% 11.2%" }
  }},
  { name: "yellow", label: "黄色", activeColor: "hsl(47.9 95.8% 53.1%)", cssVars: { 
    light: { "--primary": "47.9 95.8% 53.1%", "--primary-foreground": "26 83.3% 14.1%", "--ring": "47.9 95.8% 53.1%", "--accent": "47.9 95.8% 96%", "--accent-foreground": "47.9 95.8% 53.1%" },
    dark: { "--primary": "47.9 95.8% 53.1%", "--primary-foreground": "26 83.3% 14.1%", "--ring": "47.9 95.8% 53.1%", "--accent": "47.9 95.8% 15%", "--accent-foreground": "26 83.3% 14.1%" }
  }},
  { name: "violet", label: "紫色", activeColor: "hsl(263.4 70% 50.4%)", cssVars: { 
    light: { "--primary": "262.1 83.3% 57.8%", "--primary-foreground": "210 20% 98%", "--ring": "262.1 83.3% 57.8%", "--accent": "262.1 83.3% 96%", "--accent-foreground": "262.1 83.3% 57.8%" },
    dark: { "--primary": "263.4 70% 50.4%", "--primary-foreground": "210 20% 98%", "--ring": "263.4 70% 50.4%", "--accent": "263.4 70% 15%", "--accent-foreground": "210 20% 98%" }
  }},
];

const radiusOptions = [0, 0.25, 0.5, 0.75, 1.0];

/* ------------------------------------------------------------------ */
/*  Theme Config Context                                               */
/* ------------------------------------------------------------------ */

interface ThemeConfig {
  color: string;
  radius: number;
  layout: "full" | "centered";
}

interface ThemeConfigContextValue {
  config: ThemeConfig;
  setColor: (color: string) => void;
  setRadius: (radius: number) => void;
  setLayout: (layout: "full" | "centered") => void;
  reset: () => void;
}

const defaultConfig: ThemeConfig = { color: "blue", radius: 0.5, layout: "full" };

const ThemeConfigContext = createContext<ThemeConfigContextValue>({
  config: defaultConfig,
  setColor: () => {},
  setRadius: () => {},
  setLayout: () => {},
  reset: () => {},
});

export function useThemeConfig() {
  return useContext(ThemeConfigContext);
}

export function ThemeConfigProvider({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
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

  const applyConfig = useCallback((cfg: ThemeConfig, mode: "light" | "dark") => {
    const root = document.documentElement;
    
    // 1. Apply Radius
    root.style.setProperty("--radius", `${cfg.radius}rem`);

    // 2. Apply Theme Colors
    const theme = colorThemes.find((t) => t.name === cfg.color);
    if (theme) {
      const vars = mode === "dark" ? theme.cssVars.dark : theme.cssVars.light;
      for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
      }
    }
  }, []);

  useEffect(() => {
    applyConfig(config, resolved);
    localStorage.setItem("theme-config", JSON.stringify(config));
  }, [config, resolved, applyConfig]);

  const setColor = (color: string) => setConfig((prev) => ({ ...prev, color }));
  const setRadius = (radius: number) => setConfig((prev) => ({ ...prev, radius }));
  const setLayout = (layout: "full" | "centered") => setConfig((prev) => ({ ...prev, layout }));
  const reset = () => setConfig(defaultConfig);

  return (
    <ThemeConfigContext.Provider value={{ config, setColor, setRadius, setLayout, reset }}>
      {children}
    </ThemeConfigContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme Customizer Component                                         */
/* ------------------------------------------------------------------ */

export function ThemeCustomizer() {
  const { theme, resolved, setTheme } = useTheme();
  const { config, setColor, setRadius, setLayout, reset } = useThemeConfig();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full border-border/60 bg-background/50 backdrop-blur-sm px-3 font-bold text-xs shadow-sm hover:bg-muted/80 active:scale-95 transition-all">
          <Settings2 size={14} className="text-primary" />
          <span>界面定制</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-3xl p-6 shadow-2xl border-border/40" sideOffset={12}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-0.5">
            <h4 className="text-lg font-black tracking-tight text-foreground">界面定制</h4>
            <p className="text-[11px] font-medium text-muted-foreground">选择您喜爱的风格和颜色</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={reset}>
            <RotateCcw size={14} className="text-muted-foreground" />
          </Button>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70">主题配色</Label>
            <div className="grid grid-cols-2 gap-2">
              {colorThemes.map((t) => {
                const isActive = config.color === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setColor(t.name)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-xl border transition-all text-left",
                      isActive ? "border-foreground bg-foreground/[0.02] ring-1 ring-foreground" : "border-border/50 hover:border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="h-4 w-4 rounded-full shadow-inner" style={{ backgroundColor: t.activeColor }} />
                    <span className="text-xs font-bold text-foreground/80">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70">圆角弧度</Label>
            <div className="flex gap-2 p-1 bg-muted/50 rounded-xl">
              {radiusOptions.map((r) => (
                <button
                  key={r}
                  onClick={() => setRadius(r)}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-[11px] font-black transition-all",
                    config.radius === r ? "bg-background text-foreground shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70">颜色模式</Label>
            <div className="flex gap-2">
              {[
                { v: "light", i: Sun, l: "浅色" },
                { v: "dark", i: Moon, l: "深色" },
                { v: "system", i: Monitor, l: "系统" }
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setTheme(opt.v as any)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border transition-all",
                    theme === opt.v || (opt.v === "system" && theme === "system")
                      ? "border-foreground bg-foreground/[0.02] ring-1 ring-foreground"
                      : "border-border/50 hover:border-border hover:bg-muted/50"
                  )}
                >
                  <opt.i size={14} className={cn(theme === opt.v ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-[11px] font-bold">{opt.l}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              当前实际模式：{resolved === "dark" ? "深色" : "浅色"}
            </p>
          </div>

          <div className="space-y-3 pb-2">
            <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70">内容布局</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setLayout("full")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border transition-all",
                  config.layout === "full" ? "border-foreground bg-foreground/[0.02] ring-1 ring-foreground" : "border-border/50 hover:border-border hover:bg-muted/50"
                )}
              >
                <Maximize size={14} />
                <span className="text-[11px] font-bold">全宽</span>
              </button>
              <button
                onClick={() => setLayout("centered")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border transition-all",
                  config.layout === "centered" ? "border-foreground bg-foreground/[0.02] ring-1 ring-foreground" : "border-border/50 hover:border-border hover:bg-muted/50"
                )}
              >
                <AlignCenter size={14} />
                <span className="text-[11px] font-bold">居中</span>
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
