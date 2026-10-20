import { Link, useLocation } from "react-router-dom";

export default function Layout({ children }) {
  const location = useLocation();

  const navItems = [
    { name: "Formulations (BOM)", path: "/bom" }
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Top Navigation Bar / Tabs */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-blue-800 tracking-tight mr-8">FactoryFlow SAP</h1>
              
              {/* Desktop Tabs */}
              <nav className="hidden md:flex space-x-1">
                {navItems.map(item => {
                  const isActive = location.pathname === item.path || location.pathname === "/";
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={`px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${
                        isActive 
                          ? "bg-blue-600 text-white shadow-md border-b-0" 
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent"
                      }`}
                      style={isActive ? { transform: "translateY(1px)" } : {}}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                SAP B1 Live (Port 5002)
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="md:hidden flex overflow-x-auto bg-gray-50 border-t">
          {navItems.map(item => (
            <Link
              key={item.name}
              to={item.path}
              className="px-4 py-3 whitespace-nowrap text-sm font-medium flex-1 text-center border-b-2 border-blue-600 text-blue-600 bg-blue-50"
            >
              {item.name}
            </Link>
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
