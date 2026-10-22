import { useState, useEffect } from "react";

export default function RawMaterials() {
  const [materials, setMaterials] = useState([]);
  const [editedCosts, setEditedCosts] = useState({});
  const [savingCode, setSavingCode] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [savedCodes, setSavedCodes] = useState({});
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("ALL"); // ALL | IN_STOCK | OUT_OF_STOCK
  const [warehouseFilter, setWarehouseFilter] = useState("ALL"); // ALL | 01 | 8 | 10
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const fetchMaterials = async () => {
    setLoading(true);
    setError(null);
    try {
      const ts = Date.now();
      const [res, ordRes] = await Promise.all([
        fetch(`/api/materials?_t=${ts}`, { cache: "no-store" }),
        fetch(`/api/production?_t=${ts}`, { cache: "no-store" }).catch(() => ({ ok: false }))
      ]);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load Raw Materials from SAP");
      }
      let data = await res.json();
      const ordersData = ordRes && ordRes.ok ? await ordRes.json().catch(() => []) : [];

      // Fallback enrichment if backend has not yet populated required_qty
      if (Array.isArray(data) && data.length > 0 && data[0].required_qty === undefined && Array.isArray(ordersData)) {
        const openOrders = ordersData.filter(
          o =>
            (o.status_code === "P" || o.status_code === "R") &&
            Number(o.completed_qty || 0) < Number(o.planned_qty || 0) - 0.0001
        );
        const reqByCode = {};
        const ordersByCode = {};
        openOrders.forEach(ord => {
          (ord.lines || []).forEach(line => {
            const pending = Math.max(0, Number(line.planned_qty || 0) - Number(line.issued_qty || 0));
            if (pending <= 0.0001) return;
            const c = line.item_code;
            reqByCode[c] = (reqByCode[c] || 0) + pending;
            if (!ordersByCode[c]) ordersByCode[c] = [];
            ordersByCode[c].push({
              doc_entry: ord.doc_entry,
              doc_num: ord.doc_num,
              parent_code: ord.item_code,
              parent_name: ord.item_name,
              pending_qty: pending,
              warehouse: line.warehouse || ord.warehouse || "01",
              via_sfg: null
            });
          });
        });
        data = data.map(m => {
          const onHand = Number(m.on_hand ?? m.stock_level ?? 0);
          const onOrder = Number(m.on_order || 0);
          const reqQty = Number(reqByCode[m.code] || 0);
          const toBuy = Math.max(0, reqQty - onHand);
          return {
            ...m,
            direct_required_qty: reqQty,
            sfg_exploded_qty: 0,
            required_qty: reqQty,
            to_purchase_qty: toBuy,
            net_after_po_qty: Math.max(0, toBuy - onOrder),
            surplus_qty: Math.max(0, onHand - reqQty),
            pending_orders: ordersByCode[m.code] || []
          };
        });
      }

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

  // Helper to get displayed stock for an item depending on warehouseFilter
  const getItemStock = (m) => {
    if (warehouseFilter === "ALL") {
      return Number(m.on_hand ?? m.stock_level ?? 0);
    }
    const whMap = m.warehouse_stocks || {};
    if (whMap[warehouseFilter] !== undefined) {
      return Number(whMap[warehouseFilter] || 0);
    }
    if (warehouseFilter === "01") return Number(m.wh_01_stock || 0);
    if (warehouseFilter === "8") return Number(m.wh_8_stock || 0);
    if (warehouseFilter === "10") return Number(m.wh_10_stock || 0);
    return 0;
  };

  const filteredMaterials = materials.filter(m => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchCode = m.code && m.code.toLowerCase().includes(q);
      const matchName = m.name && m.name.toLowerCase().includes(q);
      if (!matchCode && !matchName) return false;
    }

    const st = getItemStock(m);
    const reqQty = Number(m.required_qty || 0);
    const toBuyQty = Math.max(0, reqQty - st);
    if (stockFilter === "IN_STOCK" && st <= 0) return false;
    if (stockFilter === "OUT_OF_STOCK" && st > 0) return false;
    if (stockFilter === "TO_PURCHASE" && toBuyQty <= 0.0001) return false;
    if (stockFilter === "REQUIRED" && reqQty <= 0.0001) return false;

    return true;
  });

  // KPI Metrics
  const totalMaterialsCount = materials.length;
  const inStockCount = materials.filter(m => Number(m.on_hand ?? m.stock_level ?? 0) > 0).length;
  const requiredInOrdersCount = materials.filter(m => Number(m.required_qty || 0) > 0.0001).length;
  const toPurchaseCount = materials.filter(
    m => Math.max(0, Number(m.required_qty || 0) - Number(m.on_hand ?? m.stock_level ?? 0)) > 0.0001
  ).length;
  const totalToPurchaseKg = materials.reduce(
    (sum, m) => sum + Math.max(0, Number(m.required_qty || 0) - Number(m.on_hand ?? m.stock_level ?? 0)),
    0
  );
  const totalStockBalance = filteredMaterials.reduce((sum, m) => sum + getItemStock(m), 0);
  const totalStockPurValue = filteredMaterials.reduce(
    (sum, m) => sum + getItemStock(m) * Number(m.last_purchase_cost ?? m.unit_cost ?? 0),
    0
  );

  const formatQty = (val) =>
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const formatInr = (val) =>
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  return (
    <div className="space-y-6 pb-20">
      {/* Architectural Top Header */}
      <div className="rp-card p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="sec-label mb-2">SAP HANA · ITEM MASTER (OITM &amp; OITW)</div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a1a1a] tracking-[-0.02em]">
              Raw Materials <span className="italic-accent">Stock &amp; Cost Master</span>
            </h1>
            <p className="text-xs sm:text-sm text-[#6b6863] mt-1.5 max-w-2xl">
              Displays live <span className="font-semibold text-emerald-700">SAP Stock Balance (On Hand)</span>,{" "}
              <span className="font-semibold text-[#c8102e]">Production Standard Cost</span> &amp;{" "}
              <span className="font-semibold text-[#006D77]">Last Purchase Cost</span>. Cost updates write directly to{" "}
              <code className="font-mono-code text-xs bg-[#f4f2ef] px-1.5 py-0.5 rounded-[3px] text-[#1a1a1a]">
                OITM.PrdStdCst
              </code>{" "}
              via SAP B1 Service Layer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {dirtyItems.length > 0 && (
              <button
                onClick={handleSaveAllDirty}
                disabled={savingAll}
                className="rp-btn rp-btn-red"
              >
                {savingAll
                  ? "Updating SAP via Service Layer..."
                  : `Save All Changes (${dirtyItems.length})`}
              </button>
            )}

            <button onClick={fetchMaterials} className="rp-btn rp-btn-dark">
              Refresh SAP Data
            </button>
          </div>
        </div>

        {/* 5-Cell KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 mt-6 pt-6 border-t border-black/[0.08]">
          <div className="bg-[#faf9f7] border border-black/[0.08] rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
              Total Raw Materials
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#1a1a1a] mt-1">
              {totalMaterialsCount}
            </div>
            <div className="text-[11px] text-[#8a8780] mt-0.5">
              Active items in SAP OITM
            </div>
          </div>

          <div className="bg-emerald-950/[0.03] border border-emerald-600/20 rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-emerald-800">
              Items In Stock
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-emerald-700 mt-1">
              {inStockCount}{" "}
              <span className="text-xs font-semibold text-[#6b6863]">
                / {totalMaterialsCount}
              </span>
            </div>
            <div className="text-[11px] text-emerald-800/75 mt-0.5">
              {totalMaterialsCount - inStockCount} items currently at 0 stock
            </div>
          </div>

          <div className="bg-[#006D77]/[0.04] border border-[#006D77]/20 rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#006D77]">
              Total Stock Balance {warehouseFilter !== "ALL" ? `(WH ${warehouseFilter})` : ""}
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#006D77] mt-1">
              {formatQty(totalStockBalance)} <span className="text-xs font-bold">Kg</span>
            </div>
            <div className="text-[11px] text-[#6b6863] mt-0.5">
              Across {filteredMaterials.length} filtered items
            </div>
          </div>

          <div className="bg-[#faf9f7] border border-black/[0.1] rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#444444]">
              Total Stock Value (Pur. Cost)
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#1a1a1a] mt-1">
              ₹{formatInr(totalStockPurValue)}
            </div>
            <div className="text-[11px] text-[#6b6863] mt-0.5">
              Valued at Last Purchase Price
            </div>
          </div>

          <div
            onClick={() =>
              setStockFilter(prev => (prev === "TO_PURCHASE" ? "ALL" : "TO_PURCHASE"))
            }
            className="bg-[#c8102e]/[0.05] border border-[#c8102e]/30 rounded-[4px] p-3.5 cursor-pointer hover:bg-[#c8102e]/[0.09] transition-colors"
            title="Click to filter Raw Materials that need to be purchased for pending Production Orders"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#c8102e]">
              Items to Purchase (Shortage)
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#c8102e] mt-1">
              {toPurchaseCount}{" "}
              <span className="text-xs font-bold">
                ({formatQty(totalToPurchaseKg)} Kg)
              </span>
            </div>
            <div className="text-[11px] text-[#c8102e]/80 mt-0.5">
              {requiredInOrdersCount} RM(s) needed in open orders
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3 mt-5 pt-4 border-t border-black/[0.06]">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search Item Code or Description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-black/[0.15] rounded-[4px] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#1a1a1a] font-medium focus:border-[#c8102e] focus:outline-none min-w-[250px]"
            />

            <div className="flex items-center gap-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6b6863]">
                Stock Status:
              </label>
              <select
                value={stockFilter}
                onChange={e => setStockFilter(e.target.value)}
                className="border border-black/[0.15] rounded-[4px] px-3 py-2 text-xs font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
              >
                <option value="ALL">All Items ({materials.length})</option>
                <option value="TO_PURCHASE">Shortage / To Be Purchased &gt; 0 ({toPurchaseCount})</option>
                <option value="REQUIRED">Required in Pending Orders &gt; 0 ({requiredInOrdersCount})</option>
                <option value="IN_STOCK">In Stock &gt; 0 ({inStockCount})</option>
                <option value="OUT_OF_STOCK">Out of Stock = 0 ({totalMaterialsCount - inStockCount})</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6b6863]">
                Warehouse:
              </label>
              <select
                value={warehouseFilter}
                onChange={e => setWarehouseFilter(e.target.value)}
                className="border border-black/[0.15] rounded-[4px] px-3 py-2 text-xs font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
              >
                <option value="ALL">All Warehouses (Total OnHand)</option>
                <option value="01">WH 01 — Tew Automation</option>
                <option value="8">WH 8 — Pashamylaram</option>
                <option value="10">WH 10 — Pathancheru</option>
              </select>
            </div>
          </div>

          <div className="text-xs font-mono-code text-[#6b6863]">
            Showing <span className="font-bold text-[#1a1a1a]">{filteredMaterials.length}</span> of{" "}
            <span className="font-bold text-[#1a1a1a]">{materials.length}</span> Raw Materials
          </div>
        </div>
      </div>

      {/* Status & Error Banners */}
      {statusMsg && (
        <div className="bg-emerald-950/[0.04] border-l-4 border-emerald-600 border border-emerald-600/20 text-[#1a1a1a] px-4 py-3 rounded-[4px] flex items-center justify-between text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
            <span>{statusMsg}</span>
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-[#6b6863] hover:text-[#1a1a1a] font-bold ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="bg-[#c8102e]/[0.05] border-l-4 border-[#c8102e] border border-[#c8102e]/20 text-[#1a1a1a] px-4 py-3 rounded-[4px] flex items-center justify-between text-xs sm:text-sm">
          <div>
            <span className="font-bold uppercase tracking-[0.06em] text-[#c8102e] mr-2">Error:</span>
            {error}
          </div>
          <button
            onClick={() => setError(null)}
            className="text-[#c8102e] hover:text-[#a00d24] font-bold ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="rp-card p-14 text-center">
          <div className="inline-block w-6 h-6 border-2 border-[#c8102e] border-t-transparent rounded-full animate-spin mb-3" />
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#6b6863]">
            Loading Raw Materials &amp; Stock Balances from SAP Business One HANA...
          </div>
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black/[0.08]">
              <thead className="bg-[#f4f2ef]">
                <tr>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                    SAP Code
                  </th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                    Raw Material Description
                  </th>
                  <th className="px-4 py-3.5 text-center text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                    UoM
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-emerald-800 uppercase tracking-[0.1em] bg-emerald-950/[0.04]">
                    Stock Balance (On Hand)
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-[#1a1a1a] uppercase tracking-[0.1em] bg-amber-500/[0.05]">
                    Required (Pending Orders)
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.1em] bg-[#c8102e]/[0.06]">
                    To Be Purchased (Shortage)
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-[#006D77] uppercase tracking-[0.1em] bg-[#006D77]/[0.05]">
                    Last Purchase Cost
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.1em] bg-[#c8102e]/[0.05]">
                    Production Standard Cost (Editable)
                  </th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                    Service Layer Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-black/[0.06]">
                {filteredMaterials.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-[#6b6863] italic text-sm">
                      No Raw Materials found matching your filter.
                    </td>
                  </tr>
                ) : (
                  filteredMaterials.map(m => {
                    const dirty = isRowDirty(m);
                    const isSaving = savingCode === m.code;
                    const lastPur = Number(m.last_purchase_cost ?? m.unit_cost ?? 0);
                    const stockVal = getItemStock(m);
                    const hasStock = stockVal > 0;
                    const whStocks = m.warehouse_stocks || {};
                    const activeWhBadges = Object.entries(whStocks).filter(
                      ([, qty]) => Number(qty || 0) !== 0
                    );
                    const onOrder = Number(m.on_order || 0);
                    const isCommitted = Number(m.is_committed || 0);

                    return (
                      <tr
                        key={m.code}
                        className={`hover:bg-[#faf9f7] transition-colors ${
                          dirty ? "bg-[#c8102e]/[0.03]" : ""
                        }`}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="font-mono-code text-xs font-bold px-2.5 py-1 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.09]">
                            {m.code}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 font-semibold text-[#1a1a1a] text-sm">
                          {m.name}
                        </td>

                        <td className="px-4 py-3.5 text-center text-xs text-[#6b6863] font-mono-code font-medium">
                          {m.uom || "Kg"}
                        </td>

                        {/* Stock Balance Column */}
                        <td className="px-5 py-3.5 text-right bg-emerald-950/[0.015]">
                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`font-mono-code font-bold text-sm px-2.5 py-0.5 rounded-[3px] border ${
                                hasStock
                                  ? "bg-emerald-950/[0.06] text-emerald-800 border-emerald-600/25"
                                  : "bg-[#f4f2ef] text-[#8a8780] border-black/[0.08]"
                              }`}
                            >
                              {formatQty(stockVal)} {m.uom || "Kg"}
                            </span>

                            {(activeWhBadges.length > 0 || onOrder > 0 || isCommitted > 0) && (
                              <div className="flex flex-wrap justify-end gap-1">
                                {activeWhBadges.map(([whCode, qty]) => (
                                  <span
                                    key={whCode}
                                    className="font-mono-code text-[10px] font-semibold px-1.5 py-0.2 rounded-[2px] bg-[#f4f2ef] text-[#444444] border border-black/[0.08]"
                                    title={`Warehouse ${whCode} Stock`}
                                  >
                                    WH {whCode}: {formatQty(qty)}
                                  </span>
                                ))}
                                {onOrder > 0 && (
                                  <span
                                    className="font-mono-code text-[10px] font-semibold px-1.5 py-0.2 rounded-[2px] bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/20"
                                    title="Ordered on Purchase Order"
                                  >
                                    PO: +{formatQty(onOrder)}
                                  </span>
                                )}
                                {isCommitted > 0 && (
                                  <span
                                    className="font-mono-code text-[10px] font-semibold px-1.5 py-0.2 rounded-[2px] bg-amber-500/10 text-amber-800 border border-amber-500/25"
                                    title="Committed to Production Orders"
                                  >
                                    Committed: {formatQty(isCommitted)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Required in Pending Production Orders Column */}
                        <td className="px-5 py-3.5 text-right bg-amber-500/[0.02]">
                          {Number(m.required_qty || 0) > 0.0001 ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="font-mono-code font-extrabold text-sm text-[#1a1a1a]">
                                {formatQty(m.required_qty)} {m.uom || "Kg"}
                              </span>
                              {Array.isArray(m.pending_orders) && m.pending_orders.length > 0 && (
                                <div className="flex flex-wrap justify-end gap-1">
                                  {m.pending_orders.map((po, idx) => (
                                    <span
                                      key={`${po.doc_num}_${idx}`}
                                      className="font-mono-code text-[10px] font-semibold px-1.5 py-0.2 rounded-[2px] bg-white text-[#444444] border border-black/[0.1]"
                                      title={`Order #${po.doc_num} (${po.parent_code} - ${po.parent_name})`}
                                    >
                                      Ord #{po.doc_num}: {formatQty(po.pending_qty)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono-code text-xs text-[#8a8780]">0.00 {m.uom || "Kg"}</span>
                          )}
                        </td>

                        {/* To Be Purchased (Shortage) Column */}
                        <td className="px-5 py-3.5 text-right bg-[#c8102e]/[0.02] whitespace-nowrap">
                          {(() => {
                            const reqQty = Number(m.required_qty || 0);
                            const toBuy = Math.max(0, reqQty - stockVal);
                            const surplus = Math.max(0, stockVal - reqQty);
                            if (toBuy > 0.0001) {
                              return (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-mono-code font-extrabold text-xs px-2.5 py-1 rounded-[3px] bg-[#c8102e] text-white shadow-sm">
                                    BUY {formatQty(toBuy)} {m.uom || "Kg"}
                                  </span>
                                  {onOrder > 0 && (
                                    <span className="font-mono-code text-[10px] font-semibold text-[#006D77]">
                                      PO: {formatQty(onOrder)} {m.uom || "Kg"}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            if (reqQty > 0.0001) {
                              return (
                                <span className="font-mono-code font-bold text-xs px-2 py-0.5 rounded-[3px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30">
                                  ✓ Covered (+{formatQty(surplus)} {m.uom || "Kg"})
                                </span>
                              );
                            }
                            return <span className="text-[#8a8780] font-mono-code text-xs">—</span>;
                          })()}
                        </td>

                        <td className="px-5 py-3.5 text-right font-mono-code font-bold text-sm text-[#006D77] bg-[#006D77]/[0.03]">
                          ₹{lastPur.toFixed(2)}
                        </td>

                        <td className="px-5 py-3.5 text-right bg-[#c8102e]/[0.03]">
                          <div className="inline-flex items-center justify-end gap-2">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6863] text-xs font-mono-code font-bold">
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
                                className={`w-36 pl-7 pr-3 py-1.5 text-right font-mono-code font-bold text-sm rounded-[4px] border focus:outline-none transition-colors ${
                                  dirty
                                    ? "border-[#c8102e] bg-white text-[#c8102e] ring-2 ring-[#c8102e]/15"
                                    : "border-black/[0.15] bg-white text-[#1a1a1a] focus:border-[#c8102e]"
                                }`}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2.5">
                            <button
                              onClick={() => handleSaveSingle(m)}
                              disabled={isSaving}
                              className={`rp-btn py-1.5 px-3 text-[10.5px] ${
                                dirty ? "rp-btn-red" : "rp-btn-outline"
                              }`}
                            >
                              {isSaving ? "Saving..." : "Update in SAP"}
                            </button>
                            {savedCodes[m.code] && !dirty && (
                              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-emerald-700">
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
