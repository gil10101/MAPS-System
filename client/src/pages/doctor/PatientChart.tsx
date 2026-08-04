/**
 * One patient, as their physician sees them: demographics, the visits this
 * doctor has had with them, and the medication list.
 *
 * The chart is deliberately narrow. Medical history and test results were
 * removed from the product (B1/B2), so what remains is what the scheduling
 * system genuinely owns — encounters and prescriptions. Medications stay
 * because the refill queue is built on them: stop prescribing here and there is
 * nothing for a patient to request a refill of.
 *
 * `visits` is scoped to this physician; `prescriptions` is every prescriber's,
 * because a doctor about to write a new script has to see the whole list.
 * Stopping one is still limited to whoever wrote it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, CalendarClock, Pill } from 'lucide-react';
import {
  GENDER_OPTIONS, createPrescription, fetchDoctorMe, fetchPatientChart, formatDate,
  formatTime, isOpen, stopPrescription, todayStr,
  type Chart, type Doctor, type Gender, type RxStatus, type Tone,
} from '../../lib/api';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, ReasonModal,
  Spinner, StatusBadge, Table, Tabs, Td, Textarea, Th, buttonClasses, type TabItem,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

type Tab = 'overview' | 'visits' | 'medications';

const EMPTY_RX = {
  medication: '', dosage: '', frequency: '', duration: '', instructions: '', refills_allowed: '0',
};

/** Why a medication was stopped becomes part of the record, so it is a picker
    rather than free text — these five cover what a prescriber actually means. */
const RX_STOP_REASONS = [
  'Course finished — no longer needed',
  'Adverse reaction / side effects',
  'Switched to a different medication',
  'Prescribed in error',
];

const RX_TONE: Record<RxStatus, Tone> = { active: 'green', completed: 'slate', stopped: 'red' };
const RX_LABEL: Record<RxStatus, string> = {
  active: 'Active',
  completed: 'Finished',
  stopped: 'Stopped',
};

function genderLabel(gender: Gender | null): string {
  return GENDER_OPTIONS.find((g) => g.value === gender)?.label || '—';
}

export default function PatientChart() {
  const { id } = useParams();
  const toast = useToast();
  const [chart, setChart] = useState<Chart | null>(null);
  const [me, setMe] = useState<Doctor | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const [rxOpen, setRxOpen] = useState(false);
  const [rxForm, setRxForm] = useState(EMPTY_RX);
  const [stoppingRx, setStoppingRx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    fetchPatientChart(id)
      .then(setChart)
      .catch((err) => setError((err as Error).message));
  }, [id]);

  useEffect(load, [load]);

  // Which prescriptions this doctor may stop depends on who wrote them, so the
  // portal identity is needed alongside the chart.
  useEffect(() => {
    fetchDoctorMe()
      .then((d) => setMe(d.doctor))
      .catch(() => {
        /* The chart is still readable without it; only Stop is withheld. */
      });
  }, []);

  /** Run a mutation, report it, and re-read the chart so the page is never
      showing a state the server has already moved past. */
  async function mutate(fn: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast(success, 'success');
      after?.();
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <>
        <Alert tone="error" icon={AlertCircle} className="mb-4">
          {error}
        </Alert>
        <Link to="/doctor/patients" className={buttonClasses('secondary')}>
          Back to my patients
        </Link>
      </>
    );
  }

  if (!chart) return <Spinner label="Opening chart…" />;

  const p = chart.patient;
  const activeMeds = chart.prescriptions.filter((rx) => rx.status === 'active');
  const completedVisits = chart.visits.filter((v) => v.status === 'completed');
  // Visits arrive newest first, so reversing gives chronological order and the
  // first match is the soonest. Past dates are excluded: a request from last
  // month that nobody ever approved is not an upcoming visit.
  const today = todayStr();
  const nextVisit = [...chart.visits]
    .reverse()
    .find((v) => isOpen(v.status) && v.appt_date >= today);

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'visits', label: 'Visits', count: chart.visits.length },
    { id: 'medications', label: 'Medications', count: activeMeds.length },
  ];

  return (
    <>
      <PageHeader
        back={{ to: '/doctor/patients', label: 'All patients' }}
        title={p.full_name}
        subtitle={[
          p.date_of_birth ? `DOB ${formatDate(p.date_of_birth)}` : null,
          p.email,
          p.phone,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <Tabs tabs={tabs} active={tab} onChange={(next) => setTab(next as Tab)} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Demographics">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">Date of birth</dt>
                <dd className="mt-0.5">{p.date_of_birth ? formatDate(p.date_of_birth) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Gender</dt>
                <dd className="mt-0.5">{genderLabel(p.gender)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Phone</dt>
                <dd className="mt-0.5">{p.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Email</dt>
                <dd className="mt-0.5 break-words">{p.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Address</dt>
                <dd className="mt-0.5">{p.address || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Insurance</dt>
                <dd className="mt-0.5">{p.insurance_provider || '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Care with you">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">Visits on record</dt>
                <dd className="mt-0.5 text-2xl font-extrabold leading-none">
                  {chart.visits.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Completed</dt>
                <dd className="mt-0.5 text-2xl font-extrabold leading-none">
                  {completedVisits.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Active medications</dt>
                <dd className="mt-0.5 text-2xl font-extrabold leading-none">
                  {activeMeds.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Next visit</dt>
                <dd className="mt-0.5">
                  {nextVisit ? (
                    <>
                      <span className="font-semibold">{formatDate(nextVisit.appt_date)}</span>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatTime(nextVisit.appt_time)}
                        {nextVisit.location_name ? ` · ${nextVisit.location_name}` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-500">Nothing booked</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}

      {tab === 'visits' && (
        <div className="grid gap-3">
          {chart.visits.length === 0 && (
            <Card className="p-0 sm:p-0">
              <EmptyState icon={CalendarClock} title="No visits with this patient yet">
                Appointments you see them for will be listed here with their notes.
              </EmptyState>
            </Card>
          )}
          {chart.visits.map((v) => (
            <Card key={v.id}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3>
                    {formatDate(v.appt_date)} · {formatTime(v.appt_time)}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[v.location_name, v.reason].filter(Boolean).join(' · ') || 'No reason given'}
                  </p>
                </div>
                <StatusBadge status={v.status} variant="staff" />
              </div>
              {v.notes ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{v.notes}</p>
              ) : (
                <p className="text-sm text-slate-500">
                  {v.status === 'completed'
                    ? 'Completed without a note on file.'
                    : 'This visit has not happened yet.'}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'medications' && (
        <Card className="p-0 sm:p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">Medications</h2>
            <Button
              variant="primary"
              size="sm"
              icon={Pill}
              onClick={() => {
                setRxForm(EMPTY_RX);
                setRxOpen(true);
              }}
            >
              Prescribe
            </Button>
          </div>
          {chart.prescriptions.length === 0 ? (
            <EmptyState icon={Pill} title="Nothing prescribed">
              Medications you or another prescriber add show up here, and are what a patient can
              request a refill of.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Medication</Th>
                  <Th>Directions</Th>
                  <Th>Refills</Th>
                  <Th>Prescriber</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {chart.prescriptions.map((rx) => (
                  <tr key={rx.id}>
                    <Td>
                      <span className="font-semibold">{rx.medication}</span> {rx.dosage}
                      {rx.instructions && (
                        <div className="text-xs text-slate-500">{rx.instructions}</div>
                      )}
                    </Td>
                    <Td className="text-slate-600">
                      {rx.frequency}
                      {rx.duration ? ` · ${rx.duration}` : ''}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {rx.refills_used}/{rx.refills_allowed}
                      {(rx.pending_refills || 0) > 0 && (
                        <div className="mt-1">
                          <Badge tone="amber">Request waiting</Badge>
                        </div>
                      )}
                    </Td>
                    <Td className="text-slate-600">{rx.doctor_name}</Td>
                    <Td>
                      <Badge tone={RX_TONE[rx.status]}>{RX_LABEL[rx.status]}</Badge>
                      {rx.stopped_reason && (
                        <div className="mt-1 text-xs text-slate-500">{rx.stopped_reason}</div>
                      )}
                    </Td>
                    <Td align="right">
                      {rx.status === 'active' && me && rx.doctor_id === me.id ? (
                        <Button variant="danger" size="sm" onClick={() => setStoppingRx(rx.id)}>
                          Stop
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* ----- Prescribe ----- */}
      <Modal
        open={rxOpen}
        title={`Prescribe for ${p.full_name}`}
        onClose={() => setRxOpen(false)}
        footer={
          <>
            <Button onClick={() => setRxOpen(false)}>Go back</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !rxForm.medication.trim() || !rxForm.dosage.trim() || !rxForm.frequency.trim()
              }
              onClick={() =>
                mutate(
                  () =>
                    createPrescription(id!, {
                      medication: rxForm.medication.trim(),
                      dosage: rxForm.dosage.trim(),
                      frequency: rxForm.frequency.trim(),
                      duration: rxForm.duration.trim() || undefined,
                      instructions: rxForm.instructions.trim() || undefined,
                      refills_allowed: Number(rxForm.refills_allowed) || 0,
                    }),
                  'Prescription added to the chart.',
                  () => setRxOpen(false)
                )
              }
            >
              Prescribe
            </Button>
          </>
        }
      >
        <Field label="Medication" htmlFor="rx-med" required>
          <Input
            id="rx-med"
            placeholder="e.g. Lisinopril"
            value={rxForm.medication}
            onChange={(e) => setRxForm((f) => ({ ...f, medication: e.target.value }))}
          />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Dosage" htmlFor="rx-dose" required>
            <Input
              id="rx-dose"
              placeholder="10 mg"
              value={rxForm.dosage}
              onChange={(e) => setRxForm((f) => ({ ...f, dosage: e.target.value }))}
            />
          </Field>
          <Field label="Frequency" htmlFor="rx-freq" required>
            <Input
              id="rx-freq"
              placeholder="once daily"
              value={rxForm.frequency}
              onChange={(e) => setRxForm((f) => ({ ...f, frequency: e.target.value }))}
            />
          </Field>
          <Field label="Duration" htmlFor="rx-dur">
            <Input
              id="rx-dur"
              placeholder="30 days / ongoing"
              value={rxForm.duration}
              onChange={(e) => setRxForm((f) => ({ ...f, duration: e.target.value }))}
            />
          </Field>
          <Field
            label="Refills allowed"
            htmlFor="rx-refills"
            hint="How many times this can be refilled without a new visit."
          >
            <Input
              id="rx-refills"
              type="number"
              min={0}
              max={12}
              value={rxForm.refills_allowed}
              onChange={(e) => setRxForm((f) => ({ ...f, refills_allowed: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Instructions to patient" htmlFor="rx-inst" className="mb-0">
          <Textarea
            id="rx-inst"
            rows={2}
            placeholder="e.g. Take with food."
            value={rxForm.instructions}
            onChange={(e) => setRxForm((f) => ({ ...f, instructions: e.target.value }))}
          />
        </Field>
      </Modal>

      {/* ----- Stop a medication ----- */}
      <ReasonModal
        open={stoppingRx !== null}
        busy={busy}
        title="Stop medication"
        presets={RX_STOP_REASONS}
        confirmLabel="Stop medication"
        dismissLabel="Go back"
        intro="The reason stays on the medication record, and the patient can no longer request refills of it."
        onCancel={() => setStoppingRx(null)}
        onConfirm={(reason) =>
          mutate(
            () => stopPrescription(stoppingRx!, reason),
            'Medication stopped.',
            () => setStoppingRx(null)
          )
        }
      />
    </>
  );
}
