import { Link, useLocation } from "react-router-dom";

export default function Layout({ children, user, onLogout }) {
  const location = useLocation();

  const navItems = [
    { name: "Formulations (BOM)", path: "/bom" },
    { name: "Production Orders", path: "/production" },
    { name: "Raw Materials", path: "/raw-materials" }
  ];

  const hasDistinctDisplayName =
    user?.displayName &&
    user?.username &&
    String(user.displayName).toLowerCase() !== String(user.username).toLowerCase();

  const isSuperuser = user?.superuser === "Y" || user?.role === "Superuser";

  return (
    <div className="min-h-screen flex flex-col bg-[#faf9f7] text-[#444444]">
      {/* Sticky Architectural Top Bar */}
      <header
        className="sticky top-0 z-40 border-b border-black/[0.08]"
        style={{
          backgroundColor: "rgba(250, 249, 247, 0.95)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)"
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-[76px] gap-4">
            {/* Raghav Polymers Group Brand Logo */}
            <Link
              to="/production"
              className="rp-logo flex items-center shrink-0"
              title="Raghav Polymers Group"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 530 60"
                width="310"
                height="36"
                className="w-[210px] sm:w-[290px] lg:w-[310px] h-auto block"
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
                  <linearGradient id="hlg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#c8102e" />
                    <stop offset="100%" stopColor="#a00d24" />
                  </linearGradient>
                </defs>
                <g transform="translate(4,2)">
                  <polygon className="hl-mark-red" points="0,0 20,0 36,56 16,56" fill="url(#hlg)" />
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
            </Link>

            {/* Desktop Navigation Tabs */}
            <nav className="hidden md:flex items-center gap-2">
              {navItems.map((item) => {
                const isActive =
                  location.pathname === item.path ||
                  (location.pathname === "/" && item.path === "/production");
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={`relative px-4 py-2.5 rounded-[4px] text-[11.5px] font-bold uppercase tracking-[0.09em] transition-all ${
                      isActive
                        ? "bg-[#c8102e] text-white shadow-[0_4px_12px_rgba(200,16,46,0.22)]"
                        : "text-[#444444] hover:text-[#1a1a1a] hover:bg-[#f4f2ef]"
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Right Status Indicator & Logged-In SAP User Badge */}
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10.5px] font-bold uppercase tracking-[0.1em] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08]">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                SAP B1 · SERVICE LAYER LIVE
              </span>

              {user && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] bg-white border border-black/[0.1] shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                    <span className="font-mono-code text-[11.5px] font-bold text-[#1a1a1a]">
                      {user.username}
                      {hasDistinctDisplayName ? ` · ${user.displayName}` : ""}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded-[3px] text-[9.5px] font-bold uppercase tracking-[0.08em] ${
                        isSuperuser
                          ? "bg-[#c8102e]/10 text-[#c8102e]"
                          : "bg-[#f4f2ef] text-[#6b6863]"
                      }`}
                    >
                      {isSuperuser ? "SUPERUSER" : "SAP USER"}
                    </span>
                  </div>

                  {onLogout && (
                    <button
                      type="button"
                      onClick={onLogout}
                      className="rp-btn rp-btn-outline !py-1.5 !px-3 !text-[10.5px]"
                    >
                      Sign Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="md:hidden flex border-t border-black/[0.08] bg-[#f4f2ef]">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (location.pathname === "/" && item.path === "/production");
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex-1 py-3 px-4 text-center text-[11px] font-bold uppercase tracking-[0.09em] border-b-2 transition-colors ${
                  isActive
                    ? "border-[#c8102e] text-[#c8102e] bg-white"
                    : "border-transparent text-[#6b6863] hover:text-[#1a1a1a]"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Minimal Architectural Footer */}
      <footer className="border-t border-black/[0.08] bg-[#f4f2ef] mt-auto">
        <div className="max-w-7xl mx-auto py-5 px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#6b6863]">
          <div className="flex items-center gap-2.5 font-bold uppercase tracking-[0.12em] text-[#1a1a1a]">
            <span className="inline-block w-2.5 h-2.5 bg-[#c8102e]" />
            Raghav Polymers Group
          </div>
          <div className="font-mono-code text-[11px] text-[#8a8780]">
            SAP Business One HANA · OITM, OITT &amp; OWOR Service Layer Integration
          </div>
        </div>
        <div
          style={{
            height: "4px",
            background: "linear-gradient(to right, #c8102e 83%, #1a1a1a 83%)"
          }}
        />
      </footer>
    </div>
  );
}
