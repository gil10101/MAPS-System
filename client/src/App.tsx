/**
 * MediSync route table (contract §5.2).
 *
 * Three portals share one router. Each is mounted behind <Protected> for its
 * own role rather than a blanket "is signed in" check: the portals are three
 * different applications that happen to live at one origin, so a patient who
 * lands on /admin is returned to their own home instead of being shown a shell
 * whose every request would come back 403.
 *
 * ToastProvider sits inside BrowserRouter and above <Routes> so a handler can
 * raise a message and navigate in the same breath — the toast belongs to the
 * session, not to the page that happened to trigger it.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import Protected from './components/Protected';
import Layout from './components/Layout';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';

import Dashboard from './pages/patient/Dashboard';
import Doctors from './pages/patient/Doctors';
import Appointments from './pages/patient/Appointments';
import Medications from './pages/patient/Medications';
import Profile from './pages/patient/Profile';

import DoctorSchedule from './pages/doctor/Schedule';
import DoctorPatients from './pages/doctor/Patients';
import PatientChart from './pages/doctor/PatientChart';
import DoctorRefills from './pages/doctor/Refills';
import DoctorReports from './pages/doctor/Reports';

import Overview from './pages/admin/Overview';
import AdminAppointments from './pages/admin/Appointments';
import AdminDoctors from './pages/admin/Doctors';
import PhysicianDetail from './pages/admin/PhysicianDetail';
import AdminSchedules from './pages/admin/Schedules';
import AdminLocations from './pages/admin/Locations';
import AdminSpecialties from './pages/admin/Specialties';
import AdminReports from './pages/admin/Reports';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route
            path="/app"
            element={
              <Protected role="patient">
                <Layout />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="doctors" element={<Doctors />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="medications" element={<Medications />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route
            path="/doctor"
            element={
              <Protected role="doctor">
                <Layout />
              </Protected>
            }
          >
            <Route index element={<DoctorSchedule />} />
            <Route path="patients" element={<DoctorPatients />} />
            <Route path="patients/:id" element={<PatientChart />} />
            <Route path="refills" element={<DoctorRefills />} />
            <Route path="reports" element={<DoctorReports />} />
          </Route>

          <Route
            path="/admin"
            element={
              <Protected role="admin">
                <Layout />
              </Protected>
            }
          >
            <Route index element={<Overview />} />
            <Route path="appointments" element={<AdminAppointments />} />
            <Route path="doctors" element={<AdminDoctors />} />
            <Route path="physicians/:id" element={<PhysicianDetail />} />
            <Route path="schedules" element={<AdminSchedules />} />
            <Route path="locations" element={<AdminLocations />} />
            <Route path="specialties" element={<AdminSpecialties />} />
            <Route path="reports" element={<AdminReports />} />
          </Route>

          {/* Unknown paths fall back to the landing page, which forwards an
              already-signed-in visitor on to their own portal. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
