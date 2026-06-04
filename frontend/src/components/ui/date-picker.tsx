import { format, addMonths, startOfDay, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { ChangeEvent, ChangeEventHandler, WheelEvent as ReactWheelEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMMON_TIMES,
  parseTimeInput,
  stepTime,
  TIME_STEP_MINUTES,
} from "@/components/ui/date-picker-utils";

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  includeTime?: boolean;
  minDateTime?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  className,
  includeTime = false,
  minDateTime,
}: DatePickerProps) {
  const [month, setMonth] = useState<Date>(value ?? new Date());
  const [open, setOpen] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const lastWheelStepAtRef = useRef(Number.NEGATIVE_INFINITY);

  const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  const clampToMinDateTime = (date: Date) => {
    if (!minDateTime) return date;
    return date.getTime() < minDateTime.getTime() ? new Date(minDateTime) : date;
  };

  const commitTimeValue = (time: string) => {
    const base = value ?? month ?? new Date();
    const [hoursText = "0", minutesText = "0"] = time.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    const next = new Date(base);
    next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    onChange(clampToMinDateTime(next));
  };

  const timeValue = value
    ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
    : "09:00";

  const handleCalendarChange = (
    val: string | number,
    handler: ChangeEventHandler<HTMLSelectElement>,
  ) => {
    const newEvent = {
      target: { value: String(val) },
    } as ChangeEvent<HTMLSelectElement>;
    handler(newEvent);
  };

  const minTimeValue =
    includeTime && minDateTime && value && isSameDay(value, minDateTime)
      ? `${String(minDateTime.getHours()).padStart(2, "0")}:${String(minDateTime.getMinutes()).padStart(2, "0")}`
      : undefined;

  const isTimeDisabled = (time: string) =>
    minTimeValue !== undefined && time < minTimeValue;

  const commitTimeDraft = () => {
    const parsed = parseTimeInput(timeDraft ?? "");
    if (parsed && !isTimeDisabled(parsed)) {
      commitTimeValue(parsed);
    }
    setTimeDraft(null);
  };

  const stepTimeBy = (direction: 1 | -1) => {
    const base = parseTimeInput(timeDraft ?? "") ?? timeValue;
    const next = stepTime(base, direction, TIME_STEP_MINUTES);
    if (!isTimeDisabled(next)) {
      commitTimeValue(next);
      setTimeDraft(null);
    }
  };
  const handleTimeWheel = (event: ReactWheelEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (event.deltaY === 0) return;

    const now = performance.now();
    if (now - lastWheelStepAtRef.current < 120) {
      return;
    }
    lastWheelStepAtRef.current = now;
    stepTimeBy(event.deltaY < 0 ? 1 : -1);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal h-8 text-sm",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon size={14} className="mr-1.5 shrink-0" />
          {value
            ? format(value, includeTime ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd", { locale: zhCN })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-0", includeTime ? "w-[24rem]" : "w-auto")}>
        <div className="space-y-0">
          <Calendar
            className={cn(includeTime && "w-full")}
            captionLayout="dropdown"
            components={{
              MonthCaption: (props) => <>{props.children}</>,
              DropdownNav: (props) => (
                <div className="flex w-full items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
                    onClick={() => setMonth((m) => subMonths(m, 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="flex flex-1 items-center justify-center gap-1">
                    {props.children}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
                    onClick={() => setMonth((m) => addMonths(m, 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              ),
              Dropdown: (props) => (
                <Select
                  onValueChange={(val) => {
                    if (props.onChange) {
                      handleCalendarChange(val, props.onChange);
                    }
                  }}
                  value={String(props.value)}
                >
                  <SelectTrigger className="first:flex-1 last:shrink-0 h-7 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {props.options?.map((option) => (
                      <SelectItem
                        disabled={option.disabled}
                        key={option.value}
                        value={String(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            }}
            hideNavigation
            showOutsideDays
            mode="single"
            disabled={minDateTime ? { before: startOfDay(minDateTime) } : undefined}
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
              if (!includeTime) {
                onChange(date ? clampToMinDateTime(date) : undefined);
                setOpen(false);
                return;
              }
              if (!date) {
                onChange(undefined);
                return;
              }
              const next = new Date(date);
              if (value) {
                next.setHours(value.getHours(), value.getMinutes(), 0, 0);
              } else {
                next.setHours(9, 0, 0, 0);
              }
              onChange(clampToMinDateTime(next));
            }}
            selected={value}
            locale={zhCN}
          />
          {includeTime && (
            <div className="space-y-2.5 border-t border-border p-3">
              {/* Quick-pick common times */}
              <div className="grid grid-flow-col grid-rows-3 gap-1.5">
                {COMMON_TIMES.map((time) => {
                  const active = timeValue === time;
                  const disabled = isTimeDisabled(time);
                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={disabled}
                      onClick={() => commitTimeValue(time)}
                      className={cn(
                        "h-7 min-w-0 rounded-md border px-1 text-[11px] font-medium tabular-nums transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                        disabled &&
                          "cursor-not-allowed opacity-40 hover:bg-background hover:text-foreground",
                      )}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>

              {/* Manual fine-tune + confirm */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">时间</span>
                <div className="relative">
                  <Clock
                    size={13}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="09:30"
                    aria-label="时间，可手动输入或滚动调整（每 5 分钟）"
                    title="可手动输入，或在此滚动以 5 分钟为步进调整，也可用上下方向键"
                    value={timeDraft ?? timeValue}
                    className="h-8 w-32 rounded-md border border-input bg-background pl-7 pr-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(event) => setTimeDraft(event.target.value)}
                    onBlur={commitTimeDraft}
                    onWheel={handleTimeWheel}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitTimeDraft();
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        stepTimeBy(1);
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        stepTimeBy(-1);
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto h-8"
                  onClick={() => {
                    commitTimeDraft();
                    setOpen(false);
                  }}
                >
                  确定
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
