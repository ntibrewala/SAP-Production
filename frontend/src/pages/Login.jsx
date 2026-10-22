import { useState, useEffect, useRef } from "react";

const FALLBACK_JAY_USERS = [
  { id: 1, user_code: "manager", user_name: "manager", superuser: "Y", locked: "N" },
  { id: 10, user_code: "manager1", user_name: "manager1", superuser: "Y", locked: "N" },
  { id: 11, user_code: "superuser3", user_name: "raghav", superuser: "Y", locked: "N" },
  { id: 12, user_code: "BPPLACC03", user_name: "Vasanthi", superuser: "N", locked: "N" },
  { id: 13, user_code: "BPPLINV09", user_name: "Inventory1", superuser: "N", locked: "N" },
  { id: 14, user_code: "BPPLINV02", user_name: "Annapurana", superuser: "N", locked: "N" }
];

export default function Login({ onLogin }) {
  const [users, setUsers] = useState(FALLBACK_JAY_USERS);
  const [schema, setSchema] = useState("JAY_EXTRUTECH");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const passwordInputRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function fetchSapUsers() {
      setLoadingUsers(true);
      try {
        const res = await fetch(`/api/auth/users?_t=${Date.now()}`, {
          cache: "no-store"
        });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.users || [];
          if (mounted && list.length > 0) {
            setUsers(list);
          }
          if (mounted && data.schema) {
            setSchema(data.schema);
          }
        }
      } catch (_) {
        // Keep fallback OUSR list if backend is warming up
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    }
    fetchSapUsers();
    return () => {
      mounted = false;
    };
  }, []);

  const unlockedUsers = users.filter((u) => u.locked !== "Y");

  const handleSelectUser = (userCode) => {
    setUsername(userCode);
    setError("");
    setTimeout(() => {
      passwordInputRef.current?.focus();
    }, 20);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedUser = String(username || "").trim();
    if (!trimmedUser || !password) {
      setError("Please enter both your SAP User Code and SAP Password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUser, password })
      });

      const data = await res.json();

      if (res.ok) {
        onLogin(data);
      } else {
        setError(data.message || "SAP Business One authentication failed.");
      }
    } catch (_) {
      setError("Cannot connect to SAP Production server. Please verify the backend service is running.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#faf9f7] text-[#444444]">
      {/* Top Accent Bar */}
      <div
        style={{
          height: "4px",
          background: "linear-gradient(to right, #c8102e 83%, #1a1a1a 83%)"
        }}
      />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[490px]">
          <div className="rp-card bg-white p-7 sm:p-9 border border-black/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.06)]">
            {/* Official Animated Raghav Polymers Group Brand Logo */}
            <div className="flex items-center justify-between gap-3 pb-6 mb-6 border-b border-black/[0.08]">
              <div className="rp-logo" title="Raghav Polymers Group">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 530 60"
                  width="290"
                  height="34"
                  className="w-[240px] sm:w-[290px] h-auto block"
                >
                  <defs>
                    <style>{`
                      .hl-mark-red { opacity:0; transform:translateX(-40px); animation:hlSlideIn .45s cubic-bezier(.22,1,.36,1) .1s forwards; }
                      .hl-mark-black { opacity:0; transform:translateX(-30px); animation:hlSlideIn .45s cubic-bezier(.22,1,.36,1) .28s forwards; }
                      .hl-mark-white { opacity:0; animation:hlFadeIn .25s ease .5s forwards; }
                      .hl-wordmark { opacity:0; transform:translateX(-14px); animation:hlSlideIn .4s cubic-bezier(.22,1,.36,1) .52s forwards; }
                      .hl-rule { opacity:0; transform:scaleX(0); transform-origin:left; animation:hlScaleIn .35s cubic-bezier(.22,1,.36,1) .68s forwards; }
                      .hl-desc { opacity:0; transform:translateX(-10px); animation:hlSlideIn .35s cubic-bezier(.22,1,.36,1) .76s forwards; }
                      @keyframes hlSlideIn { to { opacity:1; transform:translateX(0); } }
                      @keyframes hlFadeIn { to { opacity:1; } }
                      @keyframes hlScaleIn { to { opacity:1; transform:scaleX(1); } }
                    `}</style>
                    <linearGradient id="hlg-login" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#c8102e" />
                      <stop offset="100%" stopColor="#a00d24" />
                    </linearGradient>
                  </defs>
                  <g transform="translate(4,2)">
                    <polygon className="hl-mark-red" points="0,0 20,0 36,56 16,56" fill="url(#hlg-login)" />
                    <polygon className="hl-mark-black" points="20,0 40,0 56,56 36,56" fill="#1a1a1a" />
                    <polygon className="hl-mark-white" points="19,0 22,0 38,56 35,56" fill="#ffffff" />
                  </g>
                  <text
                    className="hl-wordmark"
                    x="66"
                    y="27"
                    fontFamily="'Montserrat',sans-serif"
                    fontSize="32"
                    fontWeight="800"
                    fill="#1a1a1a"
                    letterSpacing="0.04em"
                  >
                    RAGHAV POLYMERS
                  </text>
                  <line
                    className="hl-rule"
                    x1="66"
                    y1="35"
                    x2="112"
                    y2="35"
                    stroke="#c8102e"
                    strokeWidth="2"
                  />
                  <text
                    className="hl-desc"
                    x="67"
                    y="53"
                    fontFamily="'Montserrat',sans-serif"
                    fontSize="15"
                    fontWeight="700"
                    fill="#888580"
                    letterSpacing="0.28em"
                  >
                    GROUP
                  </text>
                </svg>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-[0.1em] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08] shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                OUSR LIVE
              </span>
            </div>

            {/* Section Header */}
            <div className="mb-6">
              <div className="sec-label mb-2">SAP BUSINESS ONE HANA · {schema}</div>
              <h1 className="text-2xl sm:text-[28px] font-extrabold text-[#1a1a1a] tracking-tight leading-tight">
                SAP Production <span className="italic-accent">Sign In</span>
              </h1>
              <p className="text-[12.5px] text-[#6b6863] mt-1.5">
                Authenticate with your SAP Business One <span className="font-mono-code font-semibold text-[#1a1a1a]">{schema}</span> user credentials via SAP Service Layer.
              </p>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="mb-5 p-3.5 rounded-[4px] bg-[#c8102e]/[0.06] border-l-4 border-[#c8102e] text-[#a00d24] text-[12px] font-semibold leading-relaxed">
                {error}
              </div>
            )}

            {/* Quick-Select Clickable User Pills from SAP OUSR */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#6b6863]">
                  Quick Select Active SAP User (OUSR)
                </span>
                {loadingUsers && (
                  <span className="text-[10px] font-mono-code text-[#8a8780]">Syncing OUSR...</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unlockedUsers.map((u) => {
                  const isSelected =
                    String(username || "").trim().toUpperCase() ===
                    String(u.user_code || "").toUpperCase();
                  const showSubName =
                    u.user_name &&
                    String(u.user_name).toLowerCase() !== String(u.user_code).toLowerCase();
                  return (
                    <button
                      key={u.user_code}
                      type="button"
                      onClick={() => handleSelectUser(u.user_code)}
                      className={`px-2.5 py-1.5 rounded-[4px] text-[11px] font-mono-code transition-all cursor-pointer border flex items-center gap-1.5 ${
                        isSelected
                          ? "bg-[#1a1a1a] text-white border-[#1a1a1a] shadow-sm font-bold"
                          : "bg-[#f4f2ef] text-[#1a1a1a] border-black/[0.08] hover:border-[#c8102e] hover:bg-white"
                      }`}
                    >
                      <span>{u.user_code}</span>
                      {showSubName && (
                        <span
                          className={`text-[10px] font-sans ${
                            isSelected ? "text-white/75" : "text-[#6b6863]"
                          }`}
                        >
                          ({u.user_name})
                        </span>
                      )}
                      {u.superuser === "Y" && (
                        <span
                          className={`text-[9px] px-1 py-0.2 rounded font-sans font-bold uppercase tracking-wider ${
                            isSelected
                              ? "bg-[#c8102e] text-white"
                              : "bg-[#c8102e]/10 text-[#c8102e]"
                          }`}
                        >
                          SU
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Dropdown Selector of SAP OUSR Users */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.09em] text-[#1a1a1a] mb-1.5">
                  Select from SAP {schema} Users
                </label>
                <select
                  value={
                    unlockedUsers.some(
                      (u) =>
                        String(u.user_code).toUpperCase() ===
                        String(username || "").trim().toUpperCase()
                    )
                      ? unlockedUsers.find(
                          (u) =>
                            String(u.user_code).toUpperCase() ===
                            String(username || "").trim().toUpperCase()
                        ).user_code
                      : ""
                  }
                  onChange={(e) => {
                    if (e.target.value) {
                      handleSelectUser(e.target.value);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 text-[13px] bg-[#faf9f7] border border-black/[0.14] rounded-[4px] text-[#1a1a1a] font-medium focus:outline-none focus:border-[#c8102e] focus:bg-white transition-colors"
                >
                  <option value="">-- Choose SAP User Account --</option>
                  {users.map((u) => {
                    const isLocked = u.locked === "Y";
                    const labelName =
                      u.user_name && u.user_name !== u.user_code
                        ? `${u.user_code} — ${u.user_name}`
                        : u.user_code;
                    return (
                      <option key={u.user_code} value={u.user_code} disabled={isLocked}>
                        {labelName} {u.superuser === "Y" ? "[Superuser]" : "[SAP User]"}
                        {isLocked ? " (Locked)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Manual SAP User Code Input */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.09em] text-[#1a1a1a] mb-1.5">
                  SAP User Code / Name (<span className="font-mono-code">USER_CODE</span>)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. manager, BPPLINV09, BPPLINV02, BPPLACC03, superuser3"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError("");
                  }}
                  className="w-full px-3.5 py-2.5 text-[13.5px] font-mono-code bg-white border border-black/[0.15] rounded-[4px] text-[#1a1a1a] focus:outline-none focus:border-[#c8102e] transition-colors"
                />
              </div>

              {/* SAP Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.09em] text-[#1a1a1a]">
                    SAP Business One Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#6b6863] hover:text-[#1a1a1a] cursor-pointer"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  ref={passwordInputRef}
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Enter your SAP B1 password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  className="w-full px-3.5 py-2.5 text-[13.5px] bg-white border border-black/[0.15] rounded-[4px] text-[#1a1a1a] focus:outline-none focus:border-[#c8102e] transition-colors"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rp-btn rp-btn-red w-full py-3 text-[12px]"
                >
                  {submitting
                    ? "Authenticating with SAP Service Layer..."
                    : "Sign In to SAP Production"}
                </button>
              </div>
            </form>

            {/* Footer Metadata */}
            <div className="mt-6 pt-4 border-t border-black/[0.08] flex items-center justify-between text-[11px] text-[#8a8780]">
              <span className="font-mono-code">Schema: {schema}</span>
              <span className="font-mono-code">Auth: OUSR + B1S v1</span>
            </div>
          </div>
        </div>
      </div>

      {/* Minimal Architectural Footer */}
      <footer className="border-t border-black/[0.08] bg-[#f4f2ef]">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#6b6863]">
          <div className="flex items-center gap-2 font-bold uppercase tracking-[0.12em] text-[#1a1a1a]">
            <span className="inline-block w-2 h-2 bg-[#c8102e]" />
            Raghav Polymers Group
          </div>
          <div className="font-mono-code text-[11px] text-[#8a8780]">
            SAP Business One HANA · {schema} Service Layer Authentication
          </div>
        </div>
      </footer>
    </div>
  );
}
