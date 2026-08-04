/**
 * Patient medications and refill requests.
 *
 * This is the patient half of the refill loop whose other half is the
 * physician's Refill Requests queue. A patient never edits a prescription —
 * they ask for more of one, and a physician decides. That is the only genuine
 * approval queue a clinician owns in this system, which is why the request is
 * its own record rather than a counter the patient could increment.
 *
 * The list is read-only apart from that one action: everything shown here was
 * written by a prescriber.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pill } from 'lucide-react';
import {
  listMyPrescriptions, requestRefill, type Prescription,
} from '../../lib/api';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner,
  Table, Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/** Directions as a prescriber would read them back: dose, then how often. */
function directions(rx: Prescription): string {
  return [rx.dosage, rx.frequency, rx.duration].filter(Boolean).join(' · ');
}

export default function Medications() {
  const toast = useToast();
  const [rows, setRows] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Prescription | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { prescriptions } = await listMyPrescriptions();
      setRows(prescriptions);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your medications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      await requestRefill(target.id, note.trim() || undefined);
      setTarget(null);
      setNote('');
      toast('Refill requested — your physician will review it.', 'success');
      await load();
    } catch (err) {
      // 409 means one is already open; the message from the API says so.
      toast(err instanceof Error ? err.message : 'Could not send the request.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const active = rows.filter((r) => r.status === 'active');
  const inactive = rows.filter((r) => r.status !== 'active');

  return (
    <>
      <PageHeader
        title="My medications"
        subtitle="Prescriptions your care team has written, and refill requests you've sent."
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Pill} title="No medications on file">
            Prescriptions written during a visit will appear here, and you can request refills
            from this page.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Active medications">
            {active.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No active medications.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Medication</Th>
                    <Th>Directions</Th>
                    <Th>Prescriber</Th>
                    <Th>Refills</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((rx) => {
                    const open = !!rx.open_request;
                    const spent = rx.refills_used >= rx.refills_allowed;
                    return (
                      <tr key={rx.id}>
                        <Td>
                          <div className="font-medium text-slate-900">{rx.medication}</div>
                          {rx.instructions && (
                            <div className="text-xs text-slate-500">{rx.instructions}</div>
                          )}
                          {rx.last_decision?.status === 'denied' && (
                            <div className="mt-1 text-xs text-rose-600">
                              Refill denied: {rx.last_decision.decision_note}
                            </div>
                          )}
                        </Td>
                        <Td>{directions(rx)}</Td>
                        <Td>{rx.doctor_name ?? '—'}</Td>
                        <Td>
                          {rx.refills_used} of {rx.refills_allowed} used
                        </Td>
                        <Td>
                          {open ? (
                            <Badge tone="amber">Request pending</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => { setTarget(rx); setNote(''); }}
                            >
                              {spent ? 'Ask about a refill' : 'Request refill'}
                            </Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {inactive.length > 0 && (
            <Card title="Past medications">
              <Table>
                <thead>
                  <tr>
                    <Th>Medication</Th>
                    <Th>Directions</Th>
                    <Th>Prescriber</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {inactive.map((rx) => (
                    <tr key={rx.id}>
                      <Td className="text-slate-900">{rx.medication}</Td>
                      <Td>{directions(rx)}</Td>
                      <Td>{rx.doctor_name ?? '—'}</Td>
                      <Td>
                        <Badge tone="slate">
                          {rx.status === 'stopped' ? 'Stopped' : 'Completed'}
                        </Badge>
                        {rx.stopped_reason && (
                          <div className="mt-1 text-xs text-slate-500">{rx.stopped_reason}</div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `Request a refill — ${target.medication}` : 'Request a refill'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>Go back</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Sending…' : 'Send request'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Your physician reviews every refill before it is authorised. You'll be notified when
          they decide.
        </p>
        <Field label="Message (optional)">
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything your physician should know"
          />
        </Field>
      </Modal>
    </>
  );
}
