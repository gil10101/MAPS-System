import { useEffect, useState } from 'react';
import {
  api, type Summary, type SpecialtyVolume, type Utilization,
} from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="small">{label}</span>
        <strong className="small">{value}</strong>
      </div>
      <div style={{ background: 'var(--line)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
        <div
          style={{ width: `${pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 999 }}
        />
      </div>
    </div>
  );
}

export default function Overview() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [utilization, setUtilization] = useState<Utilization[]>([]);
  const [volume, setVolume] = useState<SpecialtyVolume[]>([]);

  useEffect(() => {
    Promise.all([
      api<{ summary: Summary }>('/admin/reports/summary'),
      api<{ utilization: Utilization[] }>('/admin/reports/physician-utilization'),
      api<{ volume: SpecialtyVolume[] }>('/admin/reports/volume-by-specialty'),
    ])
      .then(([s, u, v]) => {
        setSummary(s.summary);
        setUtilization(u.utilization);
        setVolume(v.volume);
      })
      .catch((err) => toast((err as Error).message, 'error'));
  }, [toast]);

  const a = summary?.appointments;
  const statusItems: Array<[string, number]> = a
    ? [
        ['Booked', a.booked],
        ['Completed', a.completed],
        ['Cancelled', a.cancelled],
        ["Didn't attend", a.no_show],
      ]
    : [];
  const statusMax = Math.max(1, ...statusItems.map(([, v]) => v));
  const volumeMax = Math.max(1, ...volume.map((v) => v.total_appointments));

  return (
    <div className="container stack">
      <div>
        <h1>Clinic overview</h1>
        <p className="muted" style={{ margin: 0 }}>
          Operational metrics across all patients and physicians.
        </p>
      </div>

      <div className="grid cols-4">
        <div className="card stat">
          <div className="value teal" id="s-total">{summary ? summary.appointments.total : '–'}</div>
          <div className="label">Total appointments</div>
        </div>
        {/* No-show rate leads: it's the number clinics actually manage to, and
            the one the old model couldn't express at all. */}
        <div className="card stat">
          <div className="value" id="s-noshow">
            {summary ? `${summary.no_show_rate}%` : '–'}
          </div>
          <div className="label">No-show rate</div>
        </div>
        <div className="card stat">
          <div className="value" id="s-cancel">
            {summary ? `${summary.cancellation_rate}%` : '–'}
          </div>
          <div className="label">Cancellation rate</div>
        </div>
        <div className="card stat">
          <div className="value" id="s-unconfirmed">
            {summary ? summary.appointments.unconfirmed : '–'}
          </div>
          <div className="label">Awaiting patient reply</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card stat">
          <div className="value">{summary ? summary.total_patients : '–'}</div>
          <div className="label">Registered patients</div>
        </div>
        <div className="card stat">
          <div className="value">{summary ? summary.active_doctors : '–'}</div>
          <div className="label">Active physicians</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Appointments by status</h3>
          {!summary && <Spinner />}
          {statusItems.map(([label, value]) => (
            <Bar key={label} label={label} value={value} max={statusMax} />
          ))}
        </div>
        <div className="card">
          <h3>Volume by specialty</h3>
          {!summary && <Spinner />}
          {summary && volume.length === 0 && <p className="muted small">No data yet.</p>}
          {volume.map((v) => (
            <Bar
              key={v.specialty_name}
              label={v.specialty_name}
              value={v.total_appointments}
              max={volumeMax}
            />
          ))}
        </div>
      </div>

      <div className="card table-stack">
        <div className="card-title">
          <h3>Physician utilization</h3>
        </div>
        {!summary && <Spinner />}
        {utilization.length > 0 && (
          <div className="table-wrap" id="util">
            <table>
              <thead>
                <tr>
                  <th>Physician</th>
                  <th>Specialty</th>
                  <th>Total</th>
                  <th>Upcoming</th>
                  <th>Completed</th>
                  <th>Cancelled</th>
                  <th>No-shows</th>
                </tr>
              </thead>
              <tbody>
                {utilization.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Physician">
                      <strong>{r.full_name}</strong>
                    </td>
                    <td data-label="Specialty" className="muted">{r.specialty_name || '—'}</td>
                    <td data-label="Total">{r.total_appointments}</td>
                    <td data-label="Upcoming">{r.upcoming || 0}</td>
                    <td data-label="Completed">{r.completed || 0}</td>
                    <td data-label="Cancelled">{r.cancelled || 0}</td>
                    <td data-label="No-shows">{r.no_show || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
