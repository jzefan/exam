import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

function Calendar({
  className,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col sm:flex-row gap-4",
        month: "gap-4",
        month_caption: "relative mx-10 flex h-7 items-center justify-center",
        caption_label: "truncate text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-0 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-input bg-transparent p-0 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity",
        button_next:
          "absolute right-0 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-input bg-transparent p-0 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity",
        month_grid: "mx-auto mt-4",
        weekdays: "flex",
        weekday: "w-8 text-[0.8rem] font-normal text-muted-foreground text-center",
        week: "mt-2 flex",
        day: "relative p-0 text-center text-sm",
        day_button:
          "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] p-0 font-normal transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-selected:opacity-100",
        selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-[var(--radius)]",
        today: "bg-primary text-primary-foreground font-semibold rounded-[var(--radius)]",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
      }}
      {...props}
    />
  );
}

export { Calendar };
