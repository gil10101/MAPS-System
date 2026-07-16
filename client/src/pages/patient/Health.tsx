import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FlaskConical, HeartPulse, Pill } from 'lucide-react';
import {
  api, formatDate, formatStamp,
  HISTORY_KIND_LABEL,
  type HistoryEntry, type HistoryKind, type Prescription, type TestResult,
} from '../../lib/api';
import { Empty, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

type Tab = 'history' | 'medications' | 'results';

const EMPTY_ENTRY = { kind: 'condition' as HistoryKind, description: '', severity: '', noted_on: '' };

/** Kinds a patient can sensibly self-report (no self-diagnosed surgeries list — actually surgeries yes). */
const SELF_KINDS: HistoryKind[] = ['condition', 'allergy', 'surgery', 'immunization', 'family', 'other'];

export default function Health() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('history');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[] | null>(null);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [error, setError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ENTRY);
  const [refilling, setRefilling] = useState<Prescription | null>(null);
  const [refillNote, setRefillNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<{ history: HistoryEntry[] }>('/patients/me/history'),
      api<{ prescriptions: Prescription[] }>('/patients/me/prescriptions'),
      api<{ results: TestResult[] }>('/patients/me/test-results'),
    ])
      .then(([h, p, r]) => {
        setHistory(h.history);
        setPrescriptions(p.prescriptions);
        setResults(r.results);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  async function addEntry() {
    setBusy(true);
    try {
      await api('/patients/me/history', {
        method: 'POST',
        body: {
          kind: form.kind,
          description: form.description.trim(),
          severity: form.severity || null,
          noted_on: form.noted_on || null,
        },
      });
      toast('Added to your record. Your care team can see it.', 'success');
      setAddOpen(false);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function requestRefill() {
    if (!refilling) return;
    setBusy(true);
    try {
      await api(`/patients/me/prescriptions/${refilling.id}/refill-request`, {
        method: 'POST',
        body: { note: refillNote.trim() || undefined },
      });
      toast(`Refill request sent to ${refilling.doctor_name}.`, 'success');
      setRefilling(null);
      setRefillNote('');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const loading = !history || !prescriptions || !results;

  const TABS: Array<[Tab, string]> = [
    ['history', `History${history ? ` (${history.length})` : ''}`],
    ['medications', `Medications${prescriptions ? ` (${prescriptions.length})` : ''}`],
    ['results', `Test results${results ? ` (${results.length})` : ''}`],
  ];

  return (
    <div className="container stack">
      <div>
        <h1>My health record</h1>
        <p className="muted" style={{ margin: 0 }}>
          Your history, medications, and results — everything your care team sees.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && !error && <Spinner />}

      {!loading && (
        <>
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

          {tab === 'history' && (
            <div className="card table-stack">
              <div className="card-title">
                <h3>Medical history</h3>
                <button className="btn sm" onClick={() => { setForm(EMPTY_ENTRY); setAddOpen(true); }}>
                  <FilePlus2 className="lucide in-btn" /> Add entry
                </button>
              </div>
              {history!.length === 0 && (
                <Empty icon={HeartPulse}>
                  <p>Nothing recorded yet. Add allergies or conditions your doctors should know about.</p>
                </Empty>
              )}
              {history!.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Since</th>
                        <th>Recorded by</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history!.map((h) => (
                        <tr key={h.id}>
                          <td data-label="Type" className="nowrap">
                            {HISTORY_KIND_LABEL[h.kind]}
                            {h.severity && <div className="muted small">{h.severity}</div>}
                          </td>
                          <td data-label="Description">{h.description}</td>
                          <td data-label="Since" className="nowrap">
                            {h.noted_on ? formatDate(h.noted_on) : '—'}
                          </td>
                          <td data-label="Recorded by">
                            <span className={`badge ${h.source === 'doctor' ? 'info' : 'neutral'}`}>
                              {h.source === 'doctor' ? h.recorded_by_name || 'Clinician' : 'You'}
                            </span>
                          </td>
                          <td data-label="Status">
                            <span className={`badge ${h.status === 'active' ? 'warn' : 'neutral'}`}>
                              {h.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'medications' && (
            <div className="card table-stack">
              <div className="card-title">
                <h3>Medications</h3>
              </div>
              {prescriptions!.length === 0 && (
                <Empty icon={Pill}>
                  <p>No medications on file. Prescriptions from your doctors appear here.</p>
                </Empty>
              )}
              {prescriptions!.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Medication</th>
                        <th>Directions</th>
                        <th>Prescriber</th>
                        <th>Refills</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prescriptions!.map((rx) => (
                        <tr key={rx.id}>
                          <td data-label="Medication">
                            <strong>{rx.medication}</strong> {rx.dosage}
                            {rx.instructions && <div className="muted small">{rx.instructions}</div>}
                          </td>
                          <td data-label="Directions">
                            {rx.frequency}
                            {rx.duration ? ` · ${rx.duration}` : ''}
                          </td>
                          <td data-label="Prescriber" className="muted">{rx.doctor_name}</td>
                          <td data-label="Refills">{rx.refills_used}/{rx.refills_allowed}</td>
                          <td data-label="Status">
                            <span
                              className={`badge ${
                                rx.status === 'active' ? 'good' : rx.status === 'stopped' ? 'bad' : 'neutral'
                              }`}
                            >
                              {rx.status}
                            </span>
                            {rx.stopped_reason && <div className="muted small">{rx.stopped_reason}</div>}
                            {rx.last_request_status === 'denied' && rx.last_request_note && (
                              <div className="muted small">Refill denied: {rx.last_request_note}</div>
                            )}
                          </td>
                          <td className="actions">
                            {rx.status === 'active' ? (
                              rx.open_request_id ? (
                                <span className="badge warn">refill requested</span>
                              ) : (
                                <button
                                  className="btn secondary sm"
                                  onClick={() => {
                                    setRefilling(rx);
                                    setRefillNote('');
                                  }}
                                >
                                  Request refill
                                </button>
                              )
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
            <div className="stack">
              {results!.length === 0 && (
                <div className="card">
                  <Empty icon={FlaskConical}>
                    <p>No test results yet. Tests your doctors order appear here.</p>
                  </Empty>
                </div>
              )}
              {results!.map((t) => (
                <div className="card" key={t.id}>
                  <div className="card-title">
                    <div>
                      <h3 style={{ margin: 0 }}>{t.test_name}</h3>
                      <div className="muted small">
                        Ordered by {t.doctor_name} · {formatStamp(t.ordered_at)}
                      </div>
                    </div>
                    {t.status === 'completed' && t.result_flag ? (
                      <span
                        className={`badge ${
                          t.result_flag === 'normal' ? 'good' : t.result_flag === 'abnormal' ? 'warn' : 'bad'
                        }`}
                      >
                        {t.result_flag}
                      </span>
                    ) : (
                      <span className="badge warn">pending</span>
                    )}
                  </div>
                  {t.status === 'completed' ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{t.result_summary}</p>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>
                      Results will appear here once your doctor enters them.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ----- Self-report entry ----- */}
      <Modal
        open={addOpen}
        title="Add to your record"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setAddOpen(false)}>Go back</button>
            <button className="btn" disabled={!form.description.trim() || busy} onClick={addEntry}>
              {busy ? 'Saving…' : 'Add entry'}
            </button>
          </>
        }
      >
        <p className="muted small">
          This is added as self-reported — your care team sees it flagged as coming from you,
          which helps them without being mistaken for a diagnosis.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="p-kind">Type</label>
            <select
              id="p-kind"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as HistoryKind }))}
            >
              {SELF_KINDS.map((k) => (
                <option key={k} value={k}>{HISTORY_KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-severity">Severity (allergies)</label>
            <select
              id="p-severity"
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
            >
              <option value="">Not sure / N.A.</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-desc">Description</label>
          <textarea
            id="p-desc"
            rows={3}
            placeholder="e.g. Allergic to peanuts — throat swelling"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="p-date">When (optional)</label>
          <input
            className="input"
            type="date"
            id="p-date"
            value={form.noted_on}
            onChange={(e) => setForm((f) => ({ ...f, noted_on: e.target.value }))}
          />
        </div>
      </Modal>

      {/* ----- Request refill ----- */}
      <Modal
        open={!!refilling}
        title="Request a refill"
        onClose={() => setRefilling(null)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setRefilling(null)}>Go back</button>
            <button className="btn" disabled={busy} onClick={requestRefill}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </>
        }
      >
        {refilling && (
          <>
            <p className="muted small">
              {refilling.medication} {refilling.dosage} — goes to {refilling.doctor_name} for
              review. You'll see the decision here.
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="r-note">Message (optional)</label>
              <textarea
                id="r-note"
                rows={2}
                placeholder="e.g. Down to my last few tablets."
                value={refillNote}
                onChange={(e) => setRefillNote(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
