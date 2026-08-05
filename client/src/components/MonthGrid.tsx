/**
 * A month laid out as whole weeks, with the chrome a calendar needs and none
 * of the opinions about what belongs in a day.
 *
 * Callers render their own cell contents through `renderDay`, so the same grid
 * draws appointments on one page and a physician's published availability on
 * another without either page knowing about the other's data.
 */
import { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WEEKDAYS } from '../lib/api';
import { Button, Card, IconButton, cx } from './ui';

/**
 * Monday-first column index. Sunday is 6, not −1: `getDay() - 1` is what shifts
 * an entire month a week sideways whenever the 1st falls on a Sunday.
 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Local 'YYYY-MM-DD'. toISOString() would be UTC and can land a day early. */
export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The cells a month is drawn from — whole weeks, so the leading and trailing
 * days belong to the neighbouring months. Five rows for a short month, six for
 * a long one, computed rather than fixed at six so February does not hang an
 * empty week off the bottom.
 */
export function monthGrid(month: Date): Date[] {
  const year = month.getFullYear();
  const index = month.getMonth();
  const lead = mondayIndex(new Date(year, index, 1));
  const length = new Date(year, index + 1, 0).getDate();
  const cells = Math.ceil((lead + length) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(year, index, 1 - lead + i));
}

export interface MonthGridProps {
  month: Date;
  onMonthChange: (next: Date) => void;
  /** Cell body. `inMonth` is false for the neighbouring months' spill-over. */
  renderDay: (key: string, date: Date, inMonth: boolean) => ReactNode;
  /** Extra controls beside the month arrows. */
  actions?: ReactNode;
  /** A key or summary, rendered under the grid. */
  legend?: ReactNode;
  /** Today's date as 'YYYY-MM-DD', so the caller keeps one source of "now". */
  today: string;
  className?: string;
}

export default function MonthGrid({
  month, onMonthChange, renderDay, actions, legend, today, className,
}: MonthGridProps) {
  const cells = useMemo(() => monthGrid(month), [month]);
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const isCurrentMonth = dateKey(month).slice(0, 7) === today.slice(0, 7);

  /** Month arithmetic overflows on purpose: month 12 is January of next year. */
  const shift = (delta: number) =>
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  return (
    <Card
      className={className}
      title={label}
      actions={
        <div className="flex items-center gap-2">
          {actions}
          <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={() => shift(-1)} />
          <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={() => shift(1)} />
          {!isCurrentMonth && (
            <Button size="sm" onClick={() => onMonthChange(startOfMonth(new Date()))}>
              Today
            </Button>
          )}
        </div>
      }
    >
      {/* Seven columns cannot fit a phone at a legible size, so the grid keeps a
          floor width and scrolls inside this box. That box owns the sideways
          overflow because `html` is overflow-x: hidden — anything that escapes
          it is not scrolled to, it is silently sheared off.

          The floor is 7rem a column, matching the physician's own week and
          month grids. Narrower and a chip cannot hold a time and a name at
          once, which is the whole of what a cell is read for: at 34rem the
          chips truncated to "9:00 A…" and the grid stopped saying anything.

          Released at lg rather than sm: between md and lg the sidebar takes
          15.5rem out of the viewport, so a tablet has *less* room for the grid
          than a large phone does. */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <div className="min-w-[49rem] lg:min-w-0">
          <div className="grid grid-cols-7 gap-px">
            {[1, 2, 3, 4, 5, 6, 0].map((i) => (
              <div
                key={i}
                className="pb-1.5 text-center text-[0.7rem] font-bold uppercase tracking-wider text-slate-500"
              >
                <abbr title={WEEKDAYS[i]} className="no-underline">
                  {WEEKDAYS[i].slice(0, 3)}
                </abbr>
              </div>
            ))}
          </div>

          {/* Hairlines are the gap showing the container's own colour, so no
              cell has to know whether it is on an edge. */}
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            {cells.map((d) => {
              const key = dateKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = key === today;
              return (
                <div
                  key={key}
                  className={cx(
                    'flex min-h-[5.5rem] flex-col gap-1 p-1.5 sm:min-h-[6.5rem]',
                    inMonth ? 'bg-white' : 'bg-slate-50',
                    isToday && 'ring-1 ring-inset ring-accent-600'
                  )}
                >
                  <time
                    dateTime={key}
                    className={cx(
                      'grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold tabular-nums',
                      isToday
                        ? 'bg-accent-600 text-white'
                        : inMonth
                          ? 'text-slate-900'
                          : 'text-slate-400'
                    )}
                  >
                    {d.getDate()}
                  </time>
                  {renderDay(key, d, inMonth)}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {legend && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{legend}</div>}
    </Card>
  );
}
