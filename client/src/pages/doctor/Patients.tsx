import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { api, formatDate, initials, type CarePatient } from '../../lib/api';
import { Empty, Spinner } from '../../components/ui';

export default function DoctorPatients() {
  const [patients, setPatients] = useState<CarePatient[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api<{ patients: CarePatient[] }>('/doctor/patients')
      .then((d) => setPatients(d.patients))
      .catch((err) => {
        setError((err as Error).message);
        setPatients([]);
      });
  }, []);

  const visible = (patients || []).filter(
    (p) => !q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div className="container stack">
      <div>
        <h1>My patients</h1>
        <p className="muted" style={{ margin: 0 }}>
          Everyone under your care. Open a chart to review history, medications, and results.
        </p>
      </div>

      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pq">Search by name</label>
          <input
            className="input"
            id="pq"
            placeholder="e.g. Doe"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="card table-stack">
        {error && <div className="alert error">{error}</div>}
        {!patients && !error && <Spinner />}
        {patients && visible.length === 0 && (
          <Empty icon={Users}>
            <p>{q ? 'No patients match your search.' : 'No patients under your care yet.'}</p>
          </Empty>
        )}
        {visible.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Date of birth</th>
                  <th>Visits</th>
                  <th>Last visit</th>
                  <th>Next visit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Patient">
                      <div className="row tight" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
                        <span className="avatar sm">{initials(p.full_name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <strong>{p.full_name}</strong>
                          <div className="muted small">{p.email}</div>
                        </span>
                      </div>
                    </td>
                    <td data-label="Date of birth" className="nowrap">
                      {p.date_of_birth ? formatDate(p.date_of_birth) : '—'}
                    </td>
                    <td data-label="Visits">{p.visit_count}</td>
                    <td data-label="Last visit" className="nowrap">
                      {p.last_visit ? formatDate(p.last_visit) : '—'}
                    </td>
                    <td data-label="Next visit" className="nowrap">
                      {p.next_visit ? formatDate(p.next_visit) : '—'}
                    </td>
                    <td className="actions">
                      <Link className="btn secondary sm" to={`/doctor/patients/${p.id}`}>
                        Open chart
                      </Link>
                    </td>
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
