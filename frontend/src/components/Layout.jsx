import { Link, useLocation } from "react-router-dom";

export default function Layout({ children }) {
  const location = useLocation();

  const navItems = [
    { name: "Formulations (BOM)", path: "/bom" },
    { name: "Raw Materials", path: "/raw-materials" }
  ];

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
            {/* Brand Identity + Division Tag */}
            <div className="flex items-center gap-4 min-w-0">
              <Link to="/bom" className="flex items-center shrink-0 group" title="Raghav Polymers Group">
                <svg viewBox="0 0 530 60" className="h-9 w-auto">
                  <defs>
                    <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#c8102e" />
                      <stop offset="100%" stopColor="#a00d24" />
                    </linearGradient>
                  </defs>
                  <g transform="translate(4,2)">
                    <polygon points="20,0 40,0 56,56 36,56" fill="#1a1a1a" />
                    <polygon points="0,0 20,0 36,56 16,56" fill="url(#rg)" />
                    <polygon points="19,0 22,0 38,56 35,56" fill="rgba(255,255,255,0.85)" />
                  </g>
                  <text
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
                  <line x1="66" y1="35" x2="112" y2="35" stroke="#c8102e" strokeWidth="2" />
                  <text
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

              <div className="hidden lg:block h-7 w-[1px] bg-black/[0.12] shrink-0" />

              <div className="hidden lg:flex flex-col justify-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#006D77]">
                  JAY EXTRUTECH · SAP PRODUCTION
                </span>
                <span className="text-[11px] font-medium text-[#6b6863]">
                  Formulation &amp; Cost Engineering Portal
                </span>
              </div>
            </div>

            {/* Desktop Navigation Tabs */}
            <nav className="hidden md:flex items-center gap-2">
              {navItems.map(item => {
                const isActive =
                  location.pathname === item.path ||
                  (location.pathname === "/" && item.path === "/bom");
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

            {/* Right Status Indicator */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10.5px] font-bold uppercase tracking-[0.1em] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08]">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                SAP B1 · SERVICE LAYER LIVE
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="md:hidden flex border-t border-black/[0.08] bg-[#f4f2ef]">
          {navItems.map(item => {
            const isActive =
              location.pathname === item.path ||
              (location.pathname === "/" && item.path === "/bom");
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
      <footer className="border-t border-black/[0.08] bg-[#f4f2ef] py-5 px-4 sm:px-6 lg:px-8 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#6b6863]">
          <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.1em] text-[#1a1a1a]">
            <span className="inline-block w-2 h-2 bg-[#c8102e]" />
            Raghav Polymers Group
            <span className="text-[#8a8780] font-normal">·</span>
            <span className="text-[#006D77]">Jay Extrutech Pvt. Ltd.</span>
          </div>
          <div className="font-mono-code text-[11px] text-[#8a8780]">
            SAP Business One HANA · OITM &amp; OITT Service Layer Integration
          </div>
        </div>
      </footer>
    </div>
  );
}
