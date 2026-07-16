import { useCallback, useEffect, useState } from 'react';
import { Pill } from 'lucide-react';
import { api, formatStamp, type RefillRequest } from '../../lib/api';
import { Empty, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function DoctorRefills() {
  const toast = useToast();
  const [requests, setRequests] = useState<RefillRequest[] | null>(null);
  const [error, setError] = useState('');
  const [denying, setDenying] = useState<RefillRequest | null>(null);
  const [denyNote, setDenyNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRequests(null);
    api<{ requests: RefillRequest[] }>('/doctor/refill-requests?status=pending')
      .then((d) => setRequests(d.requests))
      .catch((err) => {
        setError((err as Error).message);
        setRequests([]);
      });
  }, []);

  useEffect(load, [load]);

  async function decide(r: RefillRequest, status: 'approved' | 'denied', note?: string) {
    setBusy(true);
    try {
      await api(`/doctor/refill-requests/${r.id}`, {
        method: 'PATCH',
        body: { status, decision_note: note },
      });
      toast(
        status === 'approved'
          ? `Refill approved for ${r.patient_name}.`
          : `Request denied — ${r.patient_name} will see your note.`,
        'success'
      );
      setDenying(null);
      setDenyNote('');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <div>
        <h1>Refill requests</h1>
        <p className="muted" style={{ margin: 0 }}>
          Patients asking to refill medications you prescribed. Approving dispenses one refill.
        </p>
      </div>

      <div className="card table-stack">
        {error && <div className="alert error">{error}</div>}
        {!requests && !error && <Spinner />}
        {requests && requests.length === 0 && (
          <Empty icon={Pill}>
            <p>No refill requests waiting. Nice.</p>
          </Empty>
        )}
        {requests && requests.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Medication</th>
                  <th>Refills used</th>
                  <th>Requested</th>
                  <th>Patient note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Patient">
                      <strong>{r.patient_name}</strong>
                      <div className="muted small">{r.patient_email}</div>
                    </td>
                    <td data-label="Medication">
                      <strong>{r.medication}</strong> {r.dosage}
                      <div className="muted small">{r.frequency}</div>
                    </td>
                    <td data-label="Refills used">
                      {r.refills_used}/{r.refills_allowed}
                      {(r.refills_used ?? 0) >= (r.refills_allowed ?? 0) && (
                        <div><span className="badge warn">over allowance</span></div>
                      )}
                    </td>
                    <td data-label="Requested" className="nowrap">{formatStamp(r.created_at)}</td>
                    <td data-label="Patient note" className="muted">{r.note || '—'}</td>
                    <td className="actions">
                      <div className="action-group">
                        <button className="btn sm" disabled={busy} onClick={() => decide(r, 'approved')}>
                          Approve
                        </button>
                        <button
                          className="btn danger sm"
                          disabled={busy}
                          onClick={() => {
                            setDenying(r);
                            setDenyNote('');
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!denying}
        title="Deny refill request"
        onClose={() => setDenying(null)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setDenying(null)}>Go back</button>
            <button
              className="btn danger"
              disabled={!denyNote.trim() || busy}
              onClick={() => denying && decide(denying, 'denied', denyNote.trim())}
            >
              {busy ? 'Saving…' : 'Deny with note'}
            </button>
          </>
        }
      >
        {denying && (
          <>
            <p className="muted small">
              {denying.medication} {denying.dosage} for {denying.patient_name}. Your note is shown
              to the patient — tell them what to do instead (e.g. book a visit).
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="deny-note">Note to patient (required)</label>
              <textarea
                id="deny-note"
                rows={3}
                placeholder="e.g. It's been a year since your last visit — please book a follow-up first."
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
