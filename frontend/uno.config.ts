import presetUno from "@unocss/preset-uno";
import transformerVariantGroup from "@unocss/transformer-variant-group";
import { defineConfig } from "unocss";

export default defineConfig({
  presets: [presetUno({ dark: "class" })],
  transformers: [transformerVariantGroup()],
  // Map shadcn/ui CSS variables to utility classes
  rules: [
    // Background utilities
    ["bg-background", { "background-color": "hsl(var(--background))" }],
    ["bg-foreground", { "background-color": "hsl(var(--foreground))" }],
    ["bg-card", { "background-color": "hsl(var(--card))" }],
    ["bg-popover", { "background-color": "hsl(var(--popover))" }],
    ["bg-primary", { "background-color": "hsl(var(--primary))" }],
    [/^bg-primary\/(\d+)$/, ([, o]) => ({ "background-color": `hsl(var(--primary) / 0.${o})` })],
    ["bg-secondary", { "background-color": "hsl(var(--secondary))" }],
    [/^bg-secondary\/(\d+)$/, ([, o]) => ({ "background-color": `hsl(var(--secondary) / 0.${o})` })],
    ["bg-muted", { "background-color": "hsl(var(--muted))" }],
    [/^bg-muted\/(\d+)$/, ([, o]) => ({ "background-color": `hsl(var(--muted) / 0.${o})` })],
    ["bg-accent", { "background-color": "hsl(var(--accent))" }],
    [/^bg-accent\/(\d+)$/, ([, o]) => ({ "background-color": `hsl(var(--accent) / 0.${o})` })],
    ["bg-destructive", { "background-color": "hsl(var(--destructive))" }],
    [/^bg-destructive\/(\d+)$/, ([, o]) => ({ "background-color": `hsl(var(--destructive) / 0.${o})` })],
    ["bg-border", { "background-color": "hsl(var(--border))" }],
    ["bg-input", { "background-color": "hsl(var(--input))" }],
    // Text utilities
    ["text-foreground", { color: "hsl(var(--foreground))" }],
    ["text-card-foreground", { color: "hsl(var(--card-foreground))" }],
    ["text-popover-foreground", { color: "hsl(var(--popover-foreground))" }],
    ["text-primary", { color: "hsl(var(--primary))" }],
    ["text-primary-foreground", { color: "hsl(var(--primary-foreground))" }],
    ["text-secondary-foreground", { color: "hsl(var(--secondary-foreground))" }],
    ["text-muted-foreground", { color: "hsl(var(--muted-foreground))" }],
    ["text-accent-foreground", { color: "hsl(var(--accent-foreground))" }],
    ["text-destructive", { color: "hsl(var(--destructive))" }],
    ["text-destructive-foreground", { color: "hsl(var(--destructive-foreground))" }],
    // Border utilities
    ["border-border", { "border-color": "hsl(var(--border))" }],
    ["border-input", { "border-color": "hsl(var(--input))" }],
    ["border-primary", { "border-color": "hsl(var(--primary))" }],
    ["border-destructive", { "border-color": "hsl(var(--destructive))" }],
    // Ring utilities
    ["ring-ring", { "--un-ring-color": "hsl(var(--ring))" }],
    ["ring-destructive", { "--un-ring-color": "hsl(var(--destructive))" }],
    ["ring-offset-background", { "--un-ring-offset-color": "hsl(var(--background))" }],
    // Divide
    ["divide-border", { "border-color": "hsl(var(--border))" }],
  ],
  shortcuts: {},
});
