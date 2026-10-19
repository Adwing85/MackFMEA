import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Gate } from "@gate";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { AssembliesPage } from "./pages/AssembliesPage";
import { AssemblyDetailPage } from "./pages/AssemblyDetailPage";
import { AuditPage } from "./pages/AuditPage";
import { ClassificationPage } from "./pages/ClassificationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FmeaDetailPage } from "./pages/FmeaDetailPage";
import { FmeaListPage } from "./pages/FmeaListPage";
import { LoginPage } from "./pages/LoginPage";
import { AttributesPage } from "./pages/admin/AttributesPage";
import { KeyTablePage } from "./pages/admin/KeyTablePage";
import { MeasuresPage } from "./pages/admin/MeasuresPage";
import { RequirementsPage } from "./pages/admin/RequirementsPage";
import { ScClassesPage } from "./pages/admin/ScClassesPage";
import { StandardsPage } from "./pages/admin/StandardsPage";
import { UsersPage } from "./pages/admin/UsersPage";

// Die Browser-Version läuft auch als lokale Datei bzw. eingebettet – dort nur Hash-Routing.
const Router = __STANDALONE__ ? HashRouter : BrowserRouter;

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export function App() {
  return (
    <Gate>
      <AuthProvider>
        <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="baugruppen" element={<AssembliesPage />} />
            <Route path="baugruppen/:id" element={<AssemblyDetailPage />} />
            <Route path="bauteile/:id/klassifikation" element={<ClassificationPage />} />
            <Route path="fmea" element={<FmeaListPage />} />
            <Route path="fmea/pruefung" element={<FmeaListPage reviewQueue />} />
            <Route path="fmea/:id" element={<FmeaDetailPage />} />
            <Route path="regelwerk/sc-klassen" element={<ScClassesPage />} />
            <Route path="regelwerk/merkmale" element={<AttributesPage />} />
            <Route path="regelwerk/werknormen" element={<StandardsPage />} />
            <Route path="regelwerk/anforderungen" element={<RequirementsPage />} />
            <Route path="regelwerk/massnahmen" element={<MeasuresPage />} />
            <Route path="regelwerk/schluessel" element={<KeyTablePage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="benutzer" element={<UsersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </Router>
      </AuthProvider>
    </Gate>
  );
}
