import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import BOM from "./pages/BOM";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/bom" element={<BOM />} />
          <Route path="*" element={<Navigate to="/bom" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
