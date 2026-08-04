/**
 * Everyone this physician has appointments with.
 *
 * The list is small enough to hold in the browser, so the search filters what
 * has already been fetched rather than round-tripping per keystroke — a clinic
 * list is scanned, and a spinner between letters would be the slower experience.
 *
 * Ordering is by last name. That is how a patient list is read aloud and how
 * every report in the system sorts people, and it is applied here as well as in
 * the query so filtering can never leave the rows in fetch order.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Search, Users } from 'lucide-react';
import { formatDate, listDoctorPatients, type CarePatient } from '../../lib/api';
import {
  Alert, Avatar, Button, Card, EmptyState, Field, Input, PageHeader, Spinner,
  Table, Td, Th, buttonClasses,
} from '../../components/ui';

export default function DoctorPatients() {
  const [patients, setPatients] = useState<CarePatient[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    listDoctorPatients()
      .then((d) => setPatients(d.patients))
      .catch((err) => {
        setError((err as Error).message);
        setPatients([]);
      });
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (patients || [])
      .filter((p) =>
        !needle ||
        [p.last_name, p.first_name, p.full_name, p.email]
          .some((field) => (field || '').toLowerCase().includes(needle))
      )
      .sort(
        (a, b) =>
          a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
      );
  }, [patients, q]);

  return (
    <>
      <PageHeader
        title="My patients"
        subtitle="Everyone under your care. Open a chart to review visits and medications."
      />

      {error && (
        <Alert tone="error" icon={AlertCircle} className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-4">
        <Field label="Search by name or email" htmlFor="patient-search" className="mb-0">
          <Input
            id="patient-search"
            type="search"
            placeholder="e.g. Alvarez"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </Card>

      <Card className="p-0 sm:p-0">
        {!patients && !error && <Spinner label="Loading your patients…" />}

        {patients && visible.length === 0 && (
          <EmptyState
            icon={q ? Search : Users}
            title={q ? 'No patients match that search' : 'No patients yet'}
            action={q ? <Button onClick={() => setQ('')}>Clear search</Button> : undefined}
          >
            {q
              ? 'Try part of a last name, or clear the search to see everyone.'
              : 'Patients appear here once they have booked an appointment with you.'}
          </EmptyState>
        )}

        {visible.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Date of birth</Th>
                <Th align="right">Visits</Th>
                <Th>Last visit</Th>
                <Th>Next visit</Th>
                <Th align="right">Chart</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.patient_id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={p.full_name} size="sm" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{p.full_name}</div>
                        <div className="truncate text-xs text-slate-500">{p.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {p.date_of_birth ? formatDate(p.date_of_birth) : '—'}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {p.visit_count}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {p.last_visit ? formatDate(p.last_visit) : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {p.next_visit ? formatDate(p.next_visit) : '—'}
                  </Td>
                  <Td align="right">
                    <Link
                      to={`/doctor/patients/${p.patient_id}`}
                      className={buttonClasses('secondary', 'sm')}
                    >
                      Open chart
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
