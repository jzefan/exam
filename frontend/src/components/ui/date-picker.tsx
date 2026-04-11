import { format, addMonths, startOfDay, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import type { ChangeEvent, ChangeEventHandler } from "react";
import { useState } from "react";

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
      <PopoverContent align="start" className="w-auto p-0">
        <div className="space-y-0">
          <Calendar
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
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">时间</span>
                <input
                  type="time"
                  value={timeValue}
                  min={minTimeValue}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  onChange={(event) => commitTimeValue(event.target.value)}
                />
                <Button type="button" size="sm" className="ml-auto h-8" onClick={() => setOpen(false)}>
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
