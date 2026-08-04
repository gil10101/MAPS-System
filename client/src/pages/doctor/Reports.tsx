/**
 * Physician reporting (A5).
 *
 * Three reports, all scoped to the signed-in doctor by the server: there is no
 * doctor picker here and no doctor_id in any request, so one physician cannot
 * pull another's numbers even by editing the URL.
 *
 *   Daily Appointments    — one day's book, in time order.
 *   My Workload           — appointments, booked hours and utilization over a range.
 *   Patient Visit History — one patient's visits with this physician, with notes.
 *
 * Patient Visit History lives here and not in the admin console (contract §3):
 * it is the one report carrying clinical notes, and the clinic's operational
 * screens deliberately have no patient-records browser.
 *
 * All three render the row shape the contract defines and export it unchanged.
 * The CSV is built from the rows already on screen (client/src/lib/csv.ts), so
 * the file a doctor mails to their practice manager is the table they were
 * looking at, filters and all, rather than a second query that might disagree
 * with it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, BarChart3, Download, Search } from 'lucide-react';
import {
  STAFF_STATUS_LABEL, doctorDailyAppointmentsReport, doctorPatientVisitsReport,
  doctorWorkloadReport, formatDate, formatTime, listDoctorPatients, monthRange, todayStr,
  type ApptStatus, type CarePatient, type DailyAppointmentRow, type PatientVisitRow,
  type Report, type ReportMeta, type WorkloadRow,
} from '../../lib/api';
import { exportCsv, reportFilename, type CsvColumn } from '../../lib/csv';
import {
  Alert, Button, Card, EmptyState, Field, FilterBar, Input, PageHeader, Select, Spinner,
  StatusBadge, Table, Tabs, Td, Th, type TabItem,
} from '../../components/ui';

type ReportId = 'daily' | 'workload' | 'visits';

const TABS: TabItem[] = [
  { id: 'daily', label: 'Daily Appointments' },
  { id: 'workload', label: 'My Workload' },
  { id: 'visits', label: 'Patient Visit History' },
];

/**
 * The "as of" line under each report title.
 *
 * A table of numbers with no stated window is uncitable a week later, and
 * these get exported and forwarded, so the range and the generation time are
 * part of the report rather than chrome around it.
 */
function metaLine(meta: ReportMeta, rows: number): string {
  const range =
    meta.from === meta.to
      ? formatDate(meta.from)
      : `${formatDate(meta.from)} – ${formatDate(meta.to)}`;
  const generated = new Date(meta.generated_at);
  const stamp = isNaN(generated.getTime()) ? meta.generated_at : generated.toLocaleString();
  return `${range} · ${rows} ${rows === 1 ? 'row' : 'rows'} · generated ${stamp}`;
}

interface ShellProps<Row> {
  title: string;
  description: string;
  /** Date pickers for this report, laid out by the shared FilterBar. */
  filters: ReactNode;
  data: Report<Row> | null;
  error: string;
  emptyTitle: string;
  emptyBody: string;
  /**
   * Set when the filters cannot yet form a question — no patient chosen. That
   * is a different state from "ran and found nothing", and a spinner there
   * would promise an answer that was never requested.
   */
  prompt?: string;
  onExport: () => void;
  children: ReactNode;
}

/**
 * Filters, heading, meta line, states and export button — identical across the
 * reports, so only the columns and the fetch differ between them.
 */
function ReportShell<Row>({
  title, description, filters, data, error, emptyTitle, emptyBody, prompt, onExport, children,
}: ShellProps<Row>) {
  const rows = data?.rows ?? [];

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterBar className="min-w-0 flex-1">{filters}</FilterBar>
          <Button icon={Download} onClick={onExport} disabled={rows.length === 0}>
            Download CSV
          </Button>
        </div>
      </Card>

      <Card className="p-0 sm:p-0">
        <div className="px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          {!prompt && data && (
            <p className="mt-2 text-xs text-slate-500">{metaLine(data.meta, rows.length)}</p>
          )}
        </div>

        {error && (
          <Alert tone="error" icon={AlertCircle} className="mx-4 mb-4 sm:mx-6">
            {error}
          </Alert>
        )}
        {prompt && !error && (
          <EmptyState icon={Search} title="Nothing to run yet">
            {prompt}
          </EmptyState>
        )}
        {!prompt && !data && !error && <Spinner label="Running report…" />}
        {!prompt && data && rows.length === 0 && (
          <EmptyState icon={BarChart3} title={emptyTitle}>
            {emptyBody}
          </EmptyState>
        )}
        {!prompt && data && rows.length > 0 && children}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Daily Appointments
// ---------------------------------------------------------------------------

const DAILY_COLUMNS: CsvColumn<DailyAppointmentRow>[] = [
  { key: 'appt_time', label: 'Time', format: (v) => formatTime(v as string) },
  { key: 'patient_name', label: 'Patient' },
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'location_name', label: 'Location' },
  // The stored value never leaves the app: a spreadsheet reader gets the same
  // words the screen shows them.
  { key: 'status', label: 'Status', format: (v) => STAFF_STATUS_LABEL[v as ApptStatus] ?? String(v) },
];

function DailyReport({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const [data, setData] = useState<Report<DailyAppointmentRow> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setData(null);
    setError('');
    doctorDailyAppointmentsReport(date)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [date]);

  useEffect(load, [load]);

  return (
    <ReportShell
      title="Daily Appointments"
      description="Everything on your book for one day, earliest first."
      data={data}
      error={error}
      emptyTitle="Nothing booked on this day"
      emptyBody="Pick another date to run the report again."
      onExport={() =>
        data && exportCsv(reportFilename('Daily Appointments', date), DAILY_COLUMNS, data.rows)
      }
      filters={
        <Field label="Date" htmlFor="report-date" className="mb-0">
          <Input
            id="report-date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && onDate(e.target.value)}
          />
        </Field>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>Patient</Th>
            <Th>Physician</Th>
            <Th>Specialty</Th>
            <Th>Location</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((row, i) => (
            <tr key={`${row.appt_time}-${row.patient_name}-${i}`}>
              <Td className="whitespace-nowrap font-semibold">{formatTime(row.appt_time)}</Td>
              <Td>{row.patient_name}</Td>
              <Td className="text-slate-600">{row.doctor_name}</Td>
              <Td className="text-slate-600">{row.specialty_name || '—'}</Td>
              <Td className="text-slate-600">{row.location_name || '—'}</Td>
              <Td>
                <StatusBadge status={row.status} variant="staff" />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </ReportShell>
  );
}

// ---------------------------------------------------------------------------
// My Workload
// ---------------------------------------------------------------------------

const WORKLOAD_COLUMNS: CsvColumn<WorkloadRow>[] = [
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'booked_hours', label: 'Booked hours' },
  { key: 'utilization_pct', label: 'Utilization %' },
];

interface Range {
  from: string;
  to: string;
}

function WorkloadReport({ range, onRange }: { range: Range; onRange: (r: Range) => void }) {
  const [data, setData] = useState<Report<WorkloadRow> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setData(null);
    setError('');
    doctorWorkloadReport(range.from, range.to)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [range.from, range.to]);

  useEffect(load, [load]);

  return (
    <ReportShell
      title="My Workload"
      description="Appointments kept, hours booked, and how much of your offered capacity they used."
      data={data}
      error={error}
      emptyTitle="No workload in this range"
      emptyBody="Widen the dates, or check that your clinic hours are set up for this period."
      onExport={() =>
        data &&
        exportCsv(
          reportFilename('My Workload', range.from, range.to),
          WORKLOAD_COLUMNS,
          data.rows
        )
      }
      filters={
        <>
          <Field label="From" htmlFor="workload-from" className="mb-0">
            <Input
              id="workload-from"
              type="date"
              value={range.from}
              onChange={(e) => e.target.value && onRange({ ...range, from: e.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="workload-to" className="mb-0">
            <Input
              id="workload-to"
              type="date"
              value={range.to}
              onChange={(e) => e.target.value && onRange({ ...range, to: e.target.value })}
            />
          </Field>
        </>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>Physician</Th>
            <Th>Specialty</Th>
            <Th align="right">Appointments</Th>
            <Th align="right">Booked hours</Th>
            <Th>Utilization</Th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((row) => {
            // Capacity can be zero (no clinic hours in the range), and the
            // server already reports 0% for that — clamp only the bar so an
            // over-booked week cannot draw past the track.
            const pct = Math.max(0, Math.min(100, Number(row.utilization_pct) || 0));
            return (
              <tr key={row.doctor_name}>
                <Td className="font-semibold">{row.doctor_name}</Td>
                <Td className="text-slate-600">{row.specialty_name || '—'}</Td>
                <Td align="right">{row.appointments}</Td>
                <Td align="right">{row.booked_hours}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-20 flex-none overflow-hidden rounded-full bg-slate-100"
                    >
                      <span
                        className="block h-full rounded-full bg-accent-600"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="font-semibold">{row.utilization_pct}%</span>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </ReportShell>
  );
}

// ---------------------------------------------------------------------------
// Patient Visit History
// ---------------------------------------------------------------------------

const VISIT_COLUMNS: CsvColumn<PatientVisitRow>[] = [
  { key: 'appt_date', label: 'Date', format: (v) => formatDate(v as string) },
  { key: 'appt_time', label: 'Time', format: (v) => formatTime(v as string) },
  { key: 'doctor_name', label: 'Physician' },
  { key: 'specialty_name', label: 'Specialty' },
  { key: 'location_name', label: 'Location' },
  { key: 'status', label: 'Status', format: (v) => STAFF_STATUS_LABEL[v as ApptStatus] ?? String(v) },
  { key: 'notes', label: 'Visit note' },
];

/**
 * One patient's visits with this physician.
 *
 * The picker is a plain select over `GET /doctor/patients` rather than a
 * typeahead: that endpoint already returns exactly this doctor's own panel,
 * sorted by surname, so the list is bounded by how many people one physician
 * treats and there is nothing to search through. It also means the control
 * cannot express a patient the server would refuse — the 403 on the report
 * route is the real gate, but the UI should not offer the mistake.
 */
function PatientVisitsReport({
  patientId, onPatient, range, onRange,
}: {
  patientId: string;
  onPatient: (id: string) => void;
  range: Range;
  onRange: (r: Range) => void;
}) {
  const [patients, setPatients] = useState<CarePatient[] | null>(null);
  const [data, setData] = useState<Report<PatientVisitRow> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listDoctorPatients()
      .then(({ patients: rows }) => setPatients(rows))
      .catch((err) => setError((err as Error).message));
  }, []);

  const load = useCallback(() => {
    if (!patientId) {
      setData(null);
      return;
    }
    setData(null);
    setError('');
    doctorPatientVisitsReport(patientId, range.from, range.to)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [patientId, range.from, range.to]);

  useEffect(load, [load]);

  const selected = useMemo(
    () => (patients ?? []).find((p) => String(p.patient_id) === patientId) ?? null,
    [patients, patientId]
  );

  return (
    <ReportShell
      title="Patient Visit History"
      description="One patient's visits with you, including the notes recorded at the time."
      data={data}
      error={error}
      prompt={patientId ? undefined : 'Choose a patient to run their visit history.'}
      emptyTitle="No visits in this range"
      emptyBody="This patient has nothing on your book between these dates. Try widening the range."
      onExport={() =>
        data &&
        exportCsv(
          // The patient's name is in the filename rather than repeated down a
          // column: it is the same on every row, and the file gets filed by it.
          reportFilename(
            `Patient Visits ${selected?.full_name ?? ''}`.trim(),
            range.from,
            range.to
          ),
          VISIT_COLUMNS,
          data.rows
        )
      }
      filters={
        <>
          <Field label="Patient" htmlFor="visits-patient" className="mb-0">
            <Select
              id="visits-patient"
              value={patientId}
              disabled={!patients}
              onChange={(e) => onPatient(e.target.value)}
            >
              <option value="">{patients ? 'Select a patient…' : 'Loading patients…'}</option>
              {(patients ?? []).map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="visits-from" className="mb-0">
            <Input
              id="visits-from"
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => e.target.value && onRange({ ...range, from: e.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="visits-to" className="mb-0">
            <Input
              id="visits-to"
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => e.target.value && onRange({ ...range, to: e.target.value })}
            />
          </Field>
        </>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Time</Th>
            <Th>Physician</Th>
            <Th>Specialty</Th>
            <Th>Location</Th>
            <Th>Status</Th>
            <Th>Visit note</Th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((row, i) => (
            <tr key={`${row.appt_date}-${row.appt_time}-${i}`}>
              <Td className="whitespace-nowrap">{formatDate(row.appt_date)}</Td>
              <Td className="whitespace-nowrap font-semibold">{formatTime(row.appt_time)}</Td>
              <Td className="text-slate-600">{row.doctor_name}</Td>
              <Td className="text-slate-600">{row.specialty_name || '—'}</Td>
              <Td className="text-slate-600">{row.location_name || '—'}</Td>
              <Td>
                <StatusBadge status={row.status} variant="staff" />
              </Td>
              <Td>
                {/* Notes are prose, not a field: they get room to wrap rather
                    than forcing the whole table sideways. */}
                {row.notes ? (
                  <span className="block min-w-[14rem] max-w-md whitespace-pre-line text-slate-600">
                    {row.notes}
                  </span>
                ) : (
                  '—'
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </ReportShell>
  );
}

// ---------------------------------------------------------------------------

export default function DoctorReports() {
  const [tab, setTab] = useState<ReportId>('daily');
  // Held here rather than inside each report so switching tabs and back does
  // not throw away a range the doctor just typed.
  const [date, setDate] = useState(todayStr);
  const [range, setRange] = useState<Range>(monthRange);
  const [patientId, setPatientId] = useState('');

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Your own book, your own workload, and your patients' visit histories. Every table downloads as CSV exactly as shown."
      />

      <Tabs tabs={TABS} active={tab} onChange={(next) => setTab(next as ReportId)} />

      {tab === 'daily' && <DailyReport date={date} onDate={setDate} />}
      {tab === 'workload' && <WorkloadReport range={range} onRange={setRange} />}
      {tab === 'visits' && (
        <PatientVisitsReport
          patientId={patientId}
          onPatient={setPatientId}
          range={range}
          onRange={setRange}
        />
      )}
    </>
  );
}
