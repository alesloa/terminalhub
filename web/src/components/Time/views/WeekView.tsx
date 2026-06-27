import { WeekStrip } from "../WeekStrip";
import { fmtDayLabel } from "../util";
import { DayView, type DayViewProps } from "./DayView";

interface Props extends Omit<DayViewProps, "showTotal"> {
  days: number[];                 // the week's 7 midnights
  onSelectDay: (dayMs: number) => void;
}

/** The week: the Mon–Sun totals strip up top, then the selected day's entries below it. */
export function WeekView({ days, onSelectDay, ...day }: Props) {
  return (
    <div className="space-y-3">
      <WeekStrip days={days} entries={day.sheet.entries} now={day.now} selected={day.day} accent={day.accent} onSelect={onSelectDay} />
      <div className="text-sm text-dim px-1">{fmtDayLabel(day.day)}</div>
      <DayView {...day} showTotal />
    </div>
  );
}
