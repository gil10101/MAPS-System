/**
 * Admin Reports — the four clinic-wide operational reports (A5).
 *
 * Patient Visit History is the fifth report and is deliberately not here. The
 * endpoint exists under /api/admin/reports because the report specification
 * puts it there, but it is the one report that carries clinical notes, and the
 * UI surfaces it in the doctor portal only (contract §3) — these screens are
 * operational and have no patient-records browser.
 *
 * Every report endpoint answers in the same `{ rows, meta }` envelope, so one
 * shell renders any of them: a controls card, a header carrying the range the
 * figures cover and the moment they were produced, a table, and a CSV
 * download. Only the column list and the controls differ per report, which is
 * why they are data here rather than four hand-written pages.
 *
 * A column is declared once and used twice — as a table cell and as a CSV
 * field. A spreadsheet that disagrees with the screen it was exported from is
 * worse than no export at all.
 *
 * Export is client-side (contract §3): the rows are already in the browser, so
 * a server endpoint would re-run the query to rebuild data the page is holding,
 * and could answer with a different range than the one on screen.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Download, Search } from 'lucide-react';
import {
  formatDate, formatStamp, formatTime, monthRange,
  reportCancellations, reportDailyAppointments,
  reportUtilization, reportWorkload, STAFF_STATUS_LABEL, todayStr,
  type CancellationRow, type CancelledBy,
  type DailyAppointmentRow, type Report,
  type UtilizationRow, type WorkloadRow,
} from '../../lib/api';
import { exportCsv, reportFilename, type CsvColumn } from '../../lib/csv';
import {
  Alert, Button, Card, EmptyState, Field, FilterBar, Input, PageHeader,
  Spinner, StatusBadge, Table, Tabs, Td, Th, type TabItem,
} from '../../components/ui';

// ===========================================================================
// Column model
// ===========================================================================

interface Column<Row> {
  key: keyof Row & string;
  label: string;
  /** Numbers right-align so magnitudes line up down the column. */
  align?: 'right';
  /** Rich cell — a badge, a wrapped note. Falls back to `text`, then the raw value. */
  cell?: (row: Row) => ReactNode;
  /** Plain-text form, used for the CSV field and for a cell with no `cell`. */
  text?: (row: Row) => string;
}

/** An empty cell reads as a dash on screen, but stays empty in the CSV. */
function renderCell<Row>(column: Column<Row>, row: Row): ReactNode {
  if (column.cell) return column.cell(row);
  if (column.text) return column.text(row) || '—';
  const value = row[column.key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function csvColumns<Row extends Record<string, any>>(columns: Column<Row>[]): CsvColumn<Row>[] {
  return columns.map((c) => ({
    key: c.key,
    label: c.label,
    format: c.text ? (_value, row) => c.text!(row) : undefined,
  }));
}

/** Cancellations name the party; no-show rows have nobody to name. */
const CANCELLED_BY_LABEL: Record<CancelledBy, string> = {
  patient: 'Patient',
  practice: 'Clinic',
  unknown: 'Unknown',
};

const DAILY_COLUMNS: Column<DailyAppointmentRow>[] = [
  { key: 'appt_time', label: 'Time', text: (r) => formatTime(r.appt_time) },
  { key: 'patient_name', label: 'Patient' },
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'location_name', label: 'Location' },
  {
    key: 'status',
    label: 'Status',
    cell: (r) => <StatusBadge status={r.status} variant="staff" />,
    text: (r) => STAFF_STATUS_LABEL[r.status],
  },
];

const WORKLOAD_COLUMNS: Column<WorkloadRow>[] = [
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'appointments', label: 'Appointments', align: 'right' },
  { key: 'booked_hours', label: 'Booked hours', align: 'right' },
  {
    key: 'utilization_pct',
    label: 'Utilization',
    align: 'right',
    text: (r) => `${r.utilization_pct}%`,
  },
];

const CANCELLATION_COLUMNS: Column<CancellationRow>[] = [
  { key: 'appt_date', label: 'Date', text: (r) => formatDate(r.appt_date) },
  { key: 'appt_time', label: 'Time', text: (r) => formatTime(r.appt_time) },
  { key: 'patient_name', label: 'Patient' },
  { key: 'doctor_name', label: 'Physician' },
  {
    key: 'status',
    label: 'Outcome',
    cell: (r) => <StatusBadge status={r.status} variant="staff" />,
    text: (r) => STAFF_STATUS_LABEL[r.status],
  },
  { key: 'cancel_reason', label: 'Reason' },
  {
    key: 'cancelled_by',
    label: 'Cancelled by',
    text: (r) => (r.cancelled_by ? CANCELLED_BY_LABEL[r.cancelled_by] : ''),
  },
  { key: 'cancelled_at', label: 'Cancelled on', text: (r) => formatStamp(r.cancelled_at) },
];

const UTILIZATION_COLUMNS: Column<UtilizationRow>[] = [
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'slots_available', label: 'Slots offered', align: 'right' },
  { key: 'slots_booked', label: 'Slots booked', align: 'right' },
  {
    key: 'utilization_pct',
    label: 'Utilization',
    align: 'right',
    text: (r) => `${r.utilization_pct}%`,
  },
  { key: 'completed', label: 'Completed', align: 'right' },
  { key: 'cancelled', label: 'Cancelled', align: 'right' },
  { key: 'no_show', label: "Didn't attend", align: 'right' },
];

// ===========================================================================
// Running a report
// ===========================================================================

interface ReportState<Row> {
  data: Report<Row> | null;
  loading: boolean;
  error: string;
}

/**
 * Run a report whenever its inputs change.
 *
 * `run` is null when the controls cannot produce a question yet — no patient
 * picked, a date cleared — which is a different state from "ran and found
 * nothing" and is rendered differently.
 *
 * The `live` flag guards against out-of-order answers: changing a date twice
 * quickly leaves two requests in flight, and the slower one must not be allowed
 * to paint over the newer range the header now claims to show.
 */
function useReport<Row>(run: (() => Promise<Report<Row>>) | null): ReportState<Row> {
  const [data, setData] = useState<Report<Row> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!run);

  useEffect(() => {
    if (!run) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    run()
      .then((result) => {
        if (!live) return;
        setData(result);
        setError('');
      })
      .catch((err) => {
        if (!live) return;
        setData(null);
        setError((err as Error).message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [run]);

  return { data, loading, error };
}

/** A single day prints as one date; anything else prints as a span. */
function rangeLabel(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/**
 * The "as of" stamp. Date and time, not just date: these tables are exported
 * and mailed around, and two runs on the same afternoon can differ.
 */
function generatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface ReportViewProps<Row extends Record<string, any>> {
  title: string;
  blurb: string;
  /** This report's controls, rendered in their own card above the results. */
  controls: ReactNode;
  columns: Column<Row>[];
  state: ReportState<Row>;
  /** Filename stem; the range is appended by reportFilename. */
  csvName: string;
  emptyTitle: string;
  emptyBody: string;
  /** Set when the controls are incomplete — says what is still missing. */
  prompt?: string;
}

function ReportView<Row extends Record<string, any>>({
  title, blurb, controls, columns, state, csvName, emptyTitle, emptyBody, prompt,
}: ReportViewProps<Row>) {
  const { data, loading, error } = state;
  const rows = data?.rows ?? [];

  function download() {
    if (!data) return;
    exportCsv(
      reportFilename(csvName, data.meta.from, data.meta.to),
      csvColumns(columns),
      rows
    );
  }

  return (
    <div>
      <Card className="mb-4">{controls}</Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{blurb}</p>
            {data && (
              <p className="mt-2 text-xs text-slate-500">
                {rangeLabel(data.meta.from, data.meta.to)} · {rows.length}{' '}
                {rows.length === 1 ? 'row' : 'rows'} · Generated{' '}
                {generatedAt(data.meta.generated_at)}
              </p>
            )}
          </div>
          <Button icon={Download} disabled={rows.length === 0} onClick={download}>
            Download CSV
          </Button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {prompt && !error && (
          <EmptyState icon={Search} title="Nothing to run yet">
            {prompt}
          </EmptyState>
        )}
        {!prompt && loading && <Spinner label="Running report…" />}
        {!prompt && !loading && !error && data && rows.length === 0 && (
          <EmptyState icon={BarChart3} title={emptyTitle}>
            {emptyBody}
          </EmptyState>
        )}
        {!prompt && !loading && !error && rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th key={c.key} align={c.align}>
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* The contract's row shapes carry no id, and the table is
                  replaced wholesale on every run, so position is identity. */}
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <Td
                      key={c.key}
                      align={c.align}
                      className={c.align === 'right' ? 'tabular-nums' : undefined}
                    >
                      {renderCell(c, row)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// Controls
// ===========================================================================

interface Range {
  from: string;
  to: string;
}

/** The from/to pair four of the five reports share. Defaults to this month. */
function RangeFields({ range, onChange }: { range: Range; onChange: (next: Range) => void }) {
  return (
    <>
      <Field label="From" htmlFor="r-from" className="mb-0">
        <Input
          id="r-from"
          type="date"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onChange({ ...range, from: e.target.value })}
        />
      </Field>
      <Field label="To" htmlFor="r-to" className="mb-0">
        <Input
          id="r-to"
          type="date"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onChange({ ...range, to: e.target.value })}
        />
      </Field>
    </>
  );
}

// ===========================================================================
// The reports
// ===========================================================================

function DailyAppointmentsReport() {
  const [date, setDate] = useState(todayStr());
  const run = useMemo(() => (date ? () => reportDailyAppointments(date) : null), [date]);
  const state = useReport(run);

  return (
    <ReportView
      title="Daily Appointments"
      blurb="Everything on the clinic's book for one day, in time order."
      controls={
        <FilterBar>
          <Field label="Date" htmlFor="r-date" className="mb-0">
            <Input
              id="r-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </FilterBar>
      }
      columns={DAILY_COLUMNS}
      state={state}
      csvName="Daily Appointments"
      emptyTitle="Nothing on the book"
      emptyBody="No appointments were scheduled for this date, at any location."
      prompt={date ? undefined : 'Pick a date to run this report.'}
    />
  );
}

function WorkloadReport() {
  const [range, setRange] = useState<Range>(() => monthRange());
  const run = useMemo(
    () => (range.from && range.to ? () => reportWorkload(range.from, range.to) : null),
    [range.from, range.to]
  );
  const state = useReport(run);

  return (
    <ReportView
      title="Doctor Workload"
      blurb="Appointments, booked hours and utilization per physician over the range."
      controls={
        <FilterBar>
          <RangeFields range={range} onChange={setRange} />
        </FilterBar>
      }
      columns={WORKLOAD_COLUMNS}
      state={state}
      csvName="Doctor Workload"
      emptyTitle="No physicians to report on"
      emptyBody="Nobody held clinic in this range. Widen the dates, or check that physicians are active."
      prompt={range.from && range.to ? undefined : 'Choose a date range to run this report.'}
    />
  );
}

function CancellationsReport() {
  const [range, setRange] = useState<Range>(() => monthRange());
  const run = useMemo(
    () => (range.from && range.to ? () => reportCancellations(range.from, range.to) : null),
    [range.from, range.to]
  );
  const state = useReport(run);

  return (
    <ReportView
      title="Appointment Cancellations"
      blurb="Every slot lost in the range, cancellations and missed appointments alike, with the reason recorded at the time."
      controls={
        <FilterBar>
          <RangeFields range={range} onChange={setRange} />
        </FilterBar>
      }
      columns={CANCELLATION_COLUMNS}
      state={state}
      csvName="Appointment Cancellations"
      emptyTitle="No lost slots"
      emptyBody="Nothing was cancelled or missed in this range."
      prompt={range.from && range.to ? undefined : 'Choose a date range to run this report.'}
    />
  );
}

function UtilizationReport() {
  const [range, setRange] = useState<Range>(() => monthRange());
  const run = useMemo(
    () => (range.from && range.to ? () => reportUtilization(range.from, range.to) : null),
    [range.from, range.to]
  );
  const state = useReport(run);

  return (
    <ReportView
      title="Provider Utilization"
      blurb="Slots the published schedule offered against the slots that were taken, and how the taken ones ended."
      controls={
        <FilterBar>
          <RangeFields range={range} onChange={setRange} />
        </FilterBar>
      }
      columns={UTILIZATION_COLUMNS}
      state={state}
      csvName="Provider Utilization"
      emptyTitle="No physicians to report on"
      emptyBody="No published schedules or appointments fall in this range."
      prompt={range.from && range.to ? undefined : 'Choose a date range to run this report.'}
    />
  );
}

// ===========================================================================
// Page
// ===========================================================================

const TABS: TabItem[] = [
  { id: 'daily', label: 'Daily Appointments' },
  { id: 'workload', label: 'Doctor Workload' },
  { id: 'cancellations', label: 'Appointment Cancellations' },
  { id: 'utilization', label: 'Provider Utilization' },
];

export default function Reports() {
  const [tab, setTab] = useState(TABS[0].id);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Four views of how the practice is running. Every one exports to CSV exactly as shown."
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* Each report is its own component, so switching tabs discards the
          previous report's controls and rows rather than showing figures from
          a range the controls no longer claim. */}
      {tab === 'daily' && <DailyAppointmentsReport />}
      {tab === 'workload' && <WorkloadReport />}
      {tab === 'cancellations' && <CancellationsReport />}
      {tab === 'utilization' && <UtilizationReport />}
    </div>
  );
}
