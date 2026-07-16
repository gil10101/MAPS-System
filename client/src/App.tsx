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
import Health from './pages/patient/Health';
import Profile from './pages/patient/Profile';

import Overview from './pages/admin/Overview';
import AdminAppointments from './pages/admin/Appointments';
import AdminDoctors from './pages/admin/Doctors';

import DoctorSchedule from './pages/doctor/Schedule';
import DoctorPatients from './pages/doctor/Patients';
import PatientChart from './pages/doctor/PatientChart';
import DoctorRefills from './pages/doctor/Refills';

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
            <Route path="health" element={<Health />} />
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
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
