import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import BOM from "./pages/BOM";
import Production from "./pages/Production";
import RawMaterials from "./pages/RawMaterials";

function getStoredSapUser() {
  try {
    const raw = localStorage.getItem("sap_jay_user");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function App() {
  const [user, setUser] = useState(getStoredSapUser);

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          localStorage.setItem("sap_jay_user", JSON.stringify(u));
          setUser(u);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Layout
        user={user}
        onLogout={() => {
          localStorage.removeItem("sap_jay_user");
          setUser(null);
        }}
      >
        <Routes>
          <Route path="/production" element={<Production user={user} />} />
          <Route path="/bom" element={<BOM user={user} />} />
          <Route path="/raw-materials" element={<RawMaterials />} />
          <Route path="*" element={<Navigate to="/production" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
