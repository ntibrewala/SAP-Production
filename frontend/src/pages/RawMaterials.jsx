import { useState, useEffect } from "react";

export default function RawMaterials() {
  const [materials, setMaterials] = useState([]);
  const [editedCosts, setEditedCosts] = useState({});
  const [savingCode, setSavingCode] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [savedCodes, setSavedCodes] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const fetchMaterials = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/materials");
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load Raw Materials from SAP");
      }
      const data = await res.json();
      setMaterials(data);

      // Initialize input state with current Production Standard Cost from SAP
      const initialEdits = {};
      data.forEach(m => {
        initialEdits[m.code] = Number(m.prod_std_cost || 0).toFixed(2);
      });
      setEditedCosts(initialEdits);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, []);

  const handleCostChange = (code, val) => {
    setEditedCosts(prev => ({ ...prev, [code]: val }));
    setSavedCodes(prev => ({ ...prev, [code]: false }));
  };

  const isRowDirty = (m) => {
    const editedVal = parseFloat(editedCosts[m.code]);
    const origVal = parseFloat(m.prod_std_cost || 0);
    if (isNaN(editedVal)) return false;
    return Math.abs(editedVal - origVal) > 0.0001;
  };

  const dirtyItems = materials.filter(isRowDirty);

  const handleSaveSingle = async (m) => {
    const val = parseFloat(editedCosts[m.code]);
    if (isNaN(val) || val < 0) {
      setError(`Please enter a valid Production Standard Cost for ${m.code}`);
      return;
    }

    setSavingCode(m.code);
    setError(null);
    setStatusMsg(null);

    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(m.code)}/std-cost`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prod_std_cost: val })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Service Layer update failed for ${m.code}`);
      }

      // Update local state
      setMaterials(prev =>
        prev.map(item =>
          item.code === m.code ? { ...item, prod_std_cost: val } : item
        )
      );
      setEditedCosts(prev => ({ ...prev, [m.code]: val.toFixed(2) }));
      setSavedCodes(prev => ({ ...prev, [m.code]: true }));
      setStatusMsg(data.message || `Updated ${m.code} Production Standard Cost to ₹${val.toFixed(2)} via SAP Service Layer`);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setSavingCode(null);
    }
  };

  const handleSaveAllDirty = async () => {
    if (dirtyItems.length === 0) return;

    setSavingAll(true);
    setError(null);
    setStatusMsg(null);

    try {
      const updates = dirtyItems.map(m => ({
        code: m.code,
        prod_std_cost: parseFloat(editedCosts[m.code])
      }));

      const res = await fetch("/api/materials/std-cost/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Batch update via SAP Service Layer failed");
      }

      const updatedMap = {};
      const newSaved = { ...savedCodes };
      updates.forEach(u => {
        updatedMap[u.code] = u.prod_std_cost;
        newSaved[u.code] = true;
      });

      setMaterials(prev =>
        prev.map(item =>
          updatedMap[item.code] !== undefined
            ? { ...item, prod_std_cost: updatedMap[item.code] }
            : item
        )
      );
      setSavedCodes(newSaved);
      setStatusMsg(data.message || `Updated ${updates.length} item(s) in SAP Item Master via Service Layer`);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  const filteredMaterials = materials.filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (m.code && m.code.toLowerCase().includes(q)) ||
      (m.name && m.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">SAP Raw Materials — Cost Master</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Displays <span className="font-semibold text-gray-700">Production Standard Cost</span> &amp; <span className="font-semibold text-gray-700">Last Purchase Cost</span>. Changes update SAP Item Master (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded">OITM.PrdStdCst</code>) via <span className="font-semibold text-blue-700">SAP B1 Service Layer</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            placeholder="Search Item Code or Name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3.5 py-2 text-sm bg-white text-gray-800 shadow-xs focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[220px]"
          />

          {dirtyItems.length > 0 && (
            <button
              onClick={handleSaveAllDirty}
              disabled={savingAll}
              className="px-4 py-2 bg-blue-600 text-white shadow-sm text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingAll
                ? "Updating SAP via Service Layer..."
                : `Save All Changes (${dirtyItems.length})`}
            </button>
          )}

          <button
            onClick={fetchMaterials}
            className="px-3.5 py-2 bg-gray-800 text-white shadow-xs text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors cursor-pointer"
          >
            Refresh SAP Data
          </button>
        </div>
      </div>

      {/* Status & Error Banners */}
      {statusMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-medium">
          <span>✓ {statusMsg}</span>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-emerald-600 hover:text-emerald-900 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between text-sm">
          <div>
            <span className="font-semibold">Error:</span> {error}
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-900 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center text-gray-500">
          Loading Raw Materials from SAP Business One...
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    SAP Code
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Raw Material Description
                  </th>
                  <th className="px-5 py-3.5 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    UoM
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-blue-700 uppercase tracking-wider bg-blue-50/40">
                    Last Purchase Cost
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-indigo-700 uppercase tracking-wider bg-indigo-50/40">
                    Production Standard Cost (Editable)
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Service Layer Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredMaterials.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-gray-500 italic">
                      No Raw Materials found matching your filter.
                    </td>
                  </tr>
                ) : (
                  filteredMaterials.map(m => {
                    const dirty = isRowDirty(m);
                    const isSaving = savingCode === m.code;
                    const lastPur = Number(m.last_purchase_cost ?? m.unit_cost ?? 0);

                    return (
                      <tr
                        key={m.code}
                        className={`hover:bg-blue-50/30 transition-colors ${
                          dirty ? "bg-amber-50/40" : ""
                        }`}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-gray-100 text-gray-800 border border-gray-200">
                            {m.code}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 font-semibold text-gray-900">
                          {m.name}
                        </td>

                        <td className="px-5 py-3.5 text-center text-xs text-gray-500 font-medium">
                          {m.uom || "Kg"}
                        </td>

                        <td className="px-5 py-3.5 text-right font-semibold text-blue-700 bg-blue-50/20">
                          ₹{lastPur.toFixed(2)}
                        </td>

                        <td className="px-5 py-3.5 text-right bg-indigo-50/20">
                          <div className="inline-flex items-center justify-end gap-2">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                                ₹
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editedCosts[m.code] ?? ""}
                                onChange={e => handleCostChange(m.code, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter") {
                                    handleSaveSingle(m);
                                  }
                                }}
                                className={`w-36 pl-7 pr-3 py-1.5 text-right font-semibold text-sm rounded-lg border focus:ring-2 focus:ring-indigo-500 focus:outline-none ${
                                  dirty
                                    ? "border-amber-400 bg-amber-50 text-gray-900"
                                    : "border-gray-300 bg-white text-gray-800"
                                }`}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => handleSaveSingle(m)}
                              disabled={isSaving}
                              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                dirty
                                  ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs"
                                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
                              }`}
                            >
                              {isSaving ? "Saving..." : "Update in SAP"}
                            </button>
                            {savedCodes[m.code] && !dirty && (
                              <span className="text-xs font-semibold text-emerald-600">
                                Saved ✓
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
