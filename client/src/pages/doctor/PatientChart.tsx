import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FilePlus2, FlaskConical, Pill } from 'lucide-react';
import {
  api, formatDate, formatStamp, formatTime, initials,
  HISTORY_KIND_LABEL,
  type Chart, type Doctor, type HistoryKind,
} from '../../lib/api';
import { Badge, Modal, ReasonModal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

type Tab = 'overview' | 'visits' | 'medications' | 'results';

const EMPTY_HISTORY = { kind: 'condition' as HistoryKind, description: '', severity: '', noted_on: '' };
const EMPTY_RX = {
  medication: '', dosage: '', frequency: '', duration: '', instructions: '', refills_allowed: '0',
};

const RX_STOP_REASONS = [
  'Course finished — no longer needed',
  'Adverse reaction / side effects',
  'Switched to a different medication',
  'Prescribed in error',
];

export default function PatientChart() {
  const { id } = useParams();
  const toast = useToast();
  const [chart, setChart] = useState<Chart | null>(null);
  const [me, setMe] = useState<Doctor | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  // Modals
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyForm, setHistoryForm] = useState(EMPTY_HISTORY);
  const [rxOpen, setRxOpen] = useState(false);
  const [rxForm, setRxForm] = useState(EMPTY_RX);
  const [stoppingRx, setStoppingRx] = useState<number | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [testName, setTestName] = useState('');
  const [resulting, setResulting] = useState<number | null>(null);
  const [resultSummary, setResultSummary] = useState('');
  const [resultFlag, setResultFlag] = useState('normal');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ chart: Chart }>(`/doctor/patients/${id}/chart`)
      .then((d) => setChart(d.chart))
      .catch((err) => setError((err as Error).message));
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    api<{ doctor: Doctor }>('/doctor/me').then((d) => setMe(d.doctor)).catch(() => {});
  }, []);

  /** Wrap a mutation: run, toast errors, reload the chart on success. */
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
      <div className="container stack">
        <div className="alert error">{error}</div>
        <Link to="/doctor/patients" className="btn secondary">
          <ArrowLeft className="lucide in-btn" /> Back to patients
        </Link>
      </div>
    );
  }
  if (!chart) {
    return (
      <div className="container">
        <Spinner />
      </div>
    );
  }

  const p = chart.profile;
  const activeMeds = chart.prescriptions.filter((rx) => rx.status === 'active');
  const allergies = chart.history.filter((h) => h.kind === 'allergy' && h.status === 'active');

  const TABS: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['visits', `Visits (${chart.visits.length})`],
    ['medications', `Medications (${activeMeds.length})`],
    ['results', `Results (${chart.results.length})`],
  ];

  return (
    <div className="container stack">
      <div>
        <Link to="/doctor/patients" className="back-link">
          <ArrowLeft className="lucide" style={{ width: '.9rem', height: '.9rem' }} /> All patients
        </Link>
        <div className="row" style={{ alignItems: 'center', marginTop: 'var(--s2)' }}>
          <span className="avatar">{initials(p.full_name)}</span>
          <div>
            <h1 style={{ margin: 0 }}>{p.full_name}</h1>
            <p className="muted small" style={{ margin: 0 }}>
              {p.date_of_birth ? `DOB ${formatDate(p.date_of_birth)} · ` : ''}
              {p.email}
              {p.phone ? ` · ${p.phone}` : ''}
            </p>
          </div>
        </div>
        {/* Allergies are the one thing that must never be below the fold. */}
        {allergies.length > 0 && (
          <div className="alert error small" style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
            <strong>Allergies:</strong>{' '}
            {allergies.map((a) => `${a.description}${a.severity ? ` (${a.severity})` : ''}`).join(' · ')}
          </div>
        )}
      </div>

      <div className="row tight">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`btn sm ${tab === key ? '' : 'secondary'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card">
            <div className="card-title">
              <h3>Demographics</h3>
            </div>
            <div className="grid cols-2">
              <div>
                <div className="muted small">Gender</div>
                <div>{p.gender ? p.gender.replace(/_/g, ' ') : '—'}</div>
              </div>
              <div>
                <div className="muted small">Insurance</div>
                <div>{p.insurance_provider || '—'}</div>
              </div>
              <div>
                <div className="muted small">Address</div>
                <div>{p.address || '—'}</div>
              </div>
              <div>
                <div className="muted small">Phone</div>
                <div>{p.phone || '—'}</div>
              </div>
            </div>
          </div>

          <div className="card table-stack">
            <div className="card-title">
              <h3>Medical history</h3>
              <button className="btn sm" onClick={() => { setHistoryForm(EMPTY_HISTORY); setHistoryOpen(true); }}>
                <FilePlus2 className="lucide in-btn" /> Add entry
              </button>
            </div>
            {chart.history.length === 0 && <p className="muted">No history recorded.</p>}
            {chart.history.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Since</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.history.map((h) => (
                      <tr key={h.id}>
                        <td data-label="Type" className="nowrap">
                          {HISTORY_KIND_LABEL[h.kind]}
                          {h.severity && <div className="muted small">{h.severity}</div>}
                        </td>
                        <td data-label="Description">{h.description}</td>
                        <td data-label="Since" className="nowrap">
                          {h.noted_on ? formatDate(h.noted_on) : '—'}
                        </td>
                        <td data-label="Source">
                          <span className={`badge ${h.source === 'doctor' ? 'info' : 'neutral'}`}>
                            {h.source === 'doctor' ? 'Clinical' : 'Self-reported'}
                          </span>
                        </td>
                        <td data-label="Status">
                          <span className={`badge ${h.status === 'active' ? 'warn' : 'neutral'}`}>
                            {h.status}
                          </span>
                        </td>
                        <td className="actions">
                          <button
                            className="btn secondary sm"
                            disabled={busy}
                            onClick={() =>
                              mutate(
                                () => api(`/doctor/history/${h.id}`, {
                                  method: 'PATCH',
                                  body: { status: h.status === 'active' ? 'resolved' : 'active' },
                                }),
                                h.status === 'active' ? 'Marked resolved.' : 'Reopened.'
                              )
                            }
                          >
                            {h.status === 'active' ? 'Mark resolved' : 'Reopen'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'visits' && (
        <div className="stack">
          {chart.visits.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>No visits yet.</p></div>
          )}
          {chart.visits.map((v) => (
            <div className="card" key={v.id}>
              <div className="card-title">
                <div>
                  <h3 style={{ margin: 0 }}>
                    {formatDate(v.appt_date)} · {formatTime(v.appt_time)}
                  </h3>
                  <div className="muted small">
                    {v.doctor_name}
                    {v.specialty_name ? ` · ${v.specialty_name}` : ''}
                    {v.reason ? ` · ${v.reason}` : ''}
                  </div>
                </div>
                <Badge status={v.status} />
              </div>
              {v.notes ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{v.notes}</p>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  {v.status === 'completed' ? 'No note on file.' : 'Visit has not happened yet.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'medications' && (
        <div className="card table-stack">
          <div className="card-title">
            <h3>Medications</h3>
            <button className="btn sm" onClick={() => { setRxForm(EMPTY_RX); setRxOpen(true); }}>
              <Pill className="lucide in-btn" /> Prescribe
            </button>
          </div>
          {chart.prescriptions.length === 0 && <p className="muted">No medications on file.</p>}
          {chart.prescriptions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Directions</th>
                    <th>Refills</th>
                    <th>Prescriber</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.prescriptions.map((rx) => (
                    <tr key={rx.id}>
                      <td data-label="Medication">
                        <strong>{rx.medication}</strong> {rx.dosage}
                        {rx.instructions && <div className="muted small">{rx.instructions}</div>}
                      </td>
                      <td data-label="Directions">
                        {rx.frequency}
                        {rx.duration ? ` · ${rx.duration}` : ''}
                      </td>
                      <td data-label="Refills">
                        {rx.refills_used}/{rx.refills_allowed}
                        {(rx.pending_refills || 0) > 0 && (
                          <div><span className="badge warn">request waiting</span></div>
                        )}
                      </td>
                      <td data-label="Prescriber" className="muted">{rx.doctor_name}</td>
                      <td data-label="Status">
                        <span
                          className={`badge ${
                            rx.status === 'active' ? 'good' : rx.status === 'stopped' ? 'bad' : 'neutral'
                          }`}
                        >
                          {rx.status}
                        </span>
                        {rx.stopped_reason && <div className="muted small">{rx.stopped_reason}</div>}
                      </td>
                      <td className="actions">
                        {rx.status === 'active' && me && rx.doctor_id === me.id ? (
                          <button className="btn danger sm" onClick={() => setStoppingRx(rx.id)}>
                            Stop
                          </button>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'results' && (
        <div className="card table-stack">
          <div className="card-title">
            <h3>Test results</h3>
            <button className="btn sm" onClick={() => { setTestName(''); setOrderOpen(true); }}>
              <FlaskConical className="lucide in-btn" /> Order test
            </button>
          </div>
          {chart.results.length === 0 && <p className="muted">No tests ordered.</p>}
          {chart.results.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Ordered</th>
                    <th>Result</th>
                    <th>Flag</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.results.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Test">
                        <strong>{t.test_name}</strong>
                        <div className="muted small">by {t.doctor_name}</div>
                      </td>
                      <td data-label="Ordered" className="nowrap">{formatStamp(t.ordered_at)}</td>
                      <td data-label="Result">
                        {t.status === 'completed' ? t.result_summary : <span className="badge warn">pending</span>}
                      </td>
                      <td data-label="Flag">
                        {t.result_flag ? (
                          <span
                            className={`badge ${
                              t.result_flag === 'normal' ? 'good' : t.result_flag === 'abnormal' ? 'warn' : 'bad'
                            }`}
                          >
                            {t.result_flag}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="actions">
                        {t.status === 'ordered' && me && t.doctor_id === me.id ? (
                          <button
                            className="btn sm"
                            onClick={() => {
                              setResulting(t.id);
                              setResultSummary('');
                              setResultFlag('normal');
                            }}
                          >
                            Enter result
                          </button>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ----- Add history entry ----- */}
      <Modal
        open={historyOpen}
        title="Add history entry"
        onClose={() => setHistoryOpen(false)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setHistoryOpen(false)}>Go back</button>
            <button
              className="btn"
              disabled={!historyForm.description.trim() || busy}
              onClick={() =>
                mutate(
                  () => api(`/doctor/patients/${id}/history`, {
                    method: 'POST',
                    body: {
                      kind: historyForm.kind,
                      description: historyForm.description.trim(),
                      severity: historyForm.severity || null,
                      noted_on: historyForm.noted_on || null,
                    },
                  }),
                  'History entry added.',
                  () => setHistoryOpen(false)
                )
              }
            >
              {busy ? 'Saving…' : 'Add to chart'}
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label htmlFor="h-kind">Type</label>
            <select
              id="h-kind"
              value={historyForm.kind}
              onChange={(e) => setHistoryForm((f) => ({ ...f, kind: e.target.value as HistoryKind }))}
            >
              {Object.entries(HISTORY_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="h-severity">Severity (allergies)</label>
            <select
              id="h-severity"
              value={historyForm.severity}
              onChange={(e) => setHistoryForm((f) => ({ ...f, severity: e.target.value }))}
            >
              <option value="">Not applicable</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="h-desc">Description</label>
          <textarea
            id="h-desc"
            rows={3}
            placeholder="e.g. Type 2 diabetes, diet-controlled"
            value={historyForm.description}
            onChange={(e) => setHistoryForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="h-date">Date diagnosed / occurred (optional)</label>
          <input
            className="input"
            type="date"
            id="h-date"
            value={historyForm.noted_on}
            onChange={(e) => setHistoryForm((f) => ({ ...f, noted_on: e.target.value }))}
          />
        </div>
      </Modal>

      {/* ----- Prescribe ----- */}
      <Modal
        open={rxOpen}
        title={`Prescribe for ${p.full_name}`}
        onClose={() => setRxOpen(false)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setRxOpen(false)}>Go back</button>
            <button
              className="btn"
              disabled={!rxForm.medication.trim() || !rxForm.dosage.trim() || !rxForm.frequency.trim() || busy}
              onClick={() =>
                mutate(
                  () => api(`/doctor/patients/${id}/prescriptions`, {
                    method: 'POST',
                    body: {
                      medication: rxForm.medication.trim(),
                      dosage: rxForm.dosage.trim(),
                      frequency: rxForm.frequency.trim(),
                      duration: rxForm.duration.trim() || null,
                      instructions: rxForm.instructions.trim() || null,
                      refills_allowed: Number(rxForm.refills_allowed) || 0,
                    },
                  }),
                  'Prescription created.',
                  () => setRxOpen(false)
                )
              }
            >
              {busy ? 'Saving…' : 'Prescribe'}
            </button>
          </>
        }
      >
        {allergies.length > 0 && (
          <div className="alert error small">
            <strong>Check allergies:</strong>{' '}
            {allergies.map((a) => a.description).join(' · ')}
          </div>
        )}
        <div className="field">
          <label htmlFor="rx-med">Medication *</label>
          <input
            className="input"
            id="rx-med"
            placeholder="e.g. Lisinopril"
            value={rxForm.medication}
            onChange={(e) => setRxForm((f) => ({ ...f, medication: e.target.value }))}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="rx-dose">Dosage *</label>
            <input
              className="input"
              id="rx-dose"
              placeholder="10 mg"
              value={rxForm.dosage}
              onChange={(e) => setRxForm((f) => ({ ...f, dosage: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="rx-freq">Frequency *</label>
            <input
              className="input"
              id="rx-freq"
              placeholder="once daily"
              value={rxForm.frequency}
              onChange={(e) => setRxForm((f) => ({ ...f, frequency: e.target.value }))}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="rx-dur">Duration</label>
            <input
              className="input"
              id="rx-dur"
              placeholder="30 days / ongoing"
              value={rxForm.duration}
              onChange={(e) => setRxForm((f) => ({ ...f, duration: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="rx-refills">Refills allowed</label>
            <input
              className="input"
              type="number"
              min={0}
              max={12}
              id="rx-refills"
              value={rxForm.refills_allowed}
              onChange={(e) => setRxForm((f) => ({ ...f, refills_allowed: e.target.value }))}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rx-inst">Instructions to patient</label>
          <textarea
            id="rx-inst"
            rows={2}
            placeholder="e.g. Take with food."
            value={rxForm.instructions}
            onChange={(e) => setRxForm((f) => ({ ...f, instructions: e.target.value }))}
          />
        </div>
      </Modal>

      {/* ----- Stop prescription ----- */}
      <ReasonModal
        open={stoppingRx !== null}
        busy={busy}
        title="Stop medication"
        presets={RX_STOP_REASONS}
        confirmLabel="Stop medication"
        dismissLabel="Go back"
        intro={<p className="muted small">The reason becomes part of the medication record.</p>}
        onCancel={() => setStoppingRx(null)}
        onConfirm={(reason) =>
          mutate(
            () => api(`/doctor/prescriptions/${stoppingRx}/stop`, { method: 'PATCH', body: { reason } }),
            'Medication stopped.',
            () => setStoppingRx(null)
          )
        }
      />

      {/* ----- Order test ----- */}
      <Modal
        open={orderOpen}
        title="Order a test"
        onClose={() => setOrderOpen(false)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setOrderOpen(false)}>Go back</button>
            <button
              className="btn"
              disabled={!testName.trim() || busy}
              onClick={() =>
                mutate(
                  () => api(`/doctor/patients/${id}/test-results`, {
                    method: 'POST',
                    body: { test_name: testName.trim() },
                  }),
                  'Test ordered.',
                  () => setOrderOpen(false)
                )
              }
            >
              {busy ? 'Saving…' : 'Order test'}
            </button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="t-name">Test name</label>
          <input
            className="input"
            id="t-name"
            placeholder="e.g. Lipid panel"
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
          />
        </div>
      </Modal>

      {/* ----- Enter result ----- */}
      <Modal
        open={resulting !== null}
        title="Enter test result"
        onClose={() => setResulting(null)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setResulting(null)}>Go back</button>
            <button
              className="btn"
              disabled={!resultSummary.trim() || busy}
              onClick={() =>
                mutate(
                  () => api(`/doctor/test-results/${resulting}`, {
                    method: 'PATCH',
                    body: { result_summary: resultSummary.trim(), result_flag: resultFlag },
                  }),
                  'Result recorded.',
                  () => setResulting(null)
                )
              }
            >
              {busy ? 'Saving…' : 'Record result'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="t-flag">Flag</label>
          <select id="t-flag" value={resultFlag} onChange={(e) => setResultFlag(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="abnormal">Abnormal</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="t-summary">Result summary (visible to the patient)</label>
          <textarea
            id="t-summary"
            rows={4}
            placeholder="Values, interpretation, and recommended follow-up."
            value={resultSummary}
            onChange={(e) => setResultSummary(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
