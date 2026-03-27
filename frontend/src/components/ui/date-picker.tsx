import { format, addMonths, subMonths } from "date-fns";
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
}

export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  className,
}: DatePickerProps) {
  const [month, setMonth] = useState<Date>(value ?? new Date());
  const [open, setOpen] = useState(false);

  const handleCalendarChange = (
    val: string | number,
    handler: ChangeEventHandler<HTMLSelectElement>,
  ) => {
    const newEvent = {
      target: { value: String(val) },
    } as ChangeEvent<HTMLSelectElement>;
    handler(newEvent);
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
          {value ? format(value, "yyyy-MM-dd", { locale: zhCN }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
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
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
          selected={value}
          locale={zhCN}
        />
      </PopoverContent>
    </Popover>
  );
}
