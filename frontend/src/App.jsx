import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import BOM from "./pages/BOM";
import Production from "./pages/Production";
import RawMaterials from "./pages/RawMaterials";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const USER_STORAGE_KEY = "sap_jay_user";
const LAST_ACTIVE_KEY = "sap_jay_last_active";

function getStoredSapUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;

    const lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
    if (lastActive && Date.now() - Number(lastActive) > IDLE_TIMEOUT_MS) {
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(LAST_ACTIVE_KEY);
      return null;
    }

    const parsed = JSON.parse(raw);
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    return parsed;
  } catch (_) {
    return null;
  }
}

function App() {
  const [user, setUser] = useState(getStoredSapUser);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;

    let timeoutId = null;
    let lastActivityTime = Date.now();
    let lastStorageWrite = lastActivityTime;
    localStorage.setItem(LAST_ACTIVE_KEY, String(lastActivityTime));

    const getEffectiveLastActive = () => {
      const stored = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      return Math.max(lastActivityTime, stored);
    };

    const checkIdleExpiration = () => {
      if (!localStorage.getItem(USER_STORAGE_KEY)) {
        setUser(null);
        return true;
      }
      if (Date.now() - getEffectiveLastActive() >= IDLE_TIMEOUT_MS) {
        handleLogout();
        return true;
      }
      return false;
    };

    const resetIdleTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!checkIdleExpiration()) {
          resetIdleTimer();
        }
      }, IDLE_TIMEOUT_MS);
    };

    const handleActivity = () => {
      if (checkIdleExpiration()) return;
      const now = Date.now();
      lastActivityTime = now;
      if (now - lastStorageWrite >= 5000) {
        lastStorageWrite = now;
        localStorage.setItem(LAST_ACTIVE_KEY, String(now));
      }
      resetIdleTimer();
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "hidden") return;
      checkIdleExpiration();
    };

    const handleStorage = (e) => {
      if (e.key === USER_STORAGE_KEY && !e.newValue) {
        setUser(null);
      }
    };

    const activityEvents = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    activityEvents.forEach((evt) =>
      window.addEventListener(evt, handleActivity, { passive: true })
    );
    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("storage", handleStorage);

    resetIdleTimer();
    const intervalId = setInterval(checkIdleExpiration, 15000);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(intervalId);
      activityEvents.forEach((evt) =>
        window.removeEventListener(evt, handleActivity)
      );
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user, handleLogout]);

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
          localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
          setUser(u);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={handleLogout}>
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
