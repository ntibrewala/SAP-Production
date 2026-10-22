import { useState, useEffect, Fragment } from "react";

const DEFAULT_WAREHOUSES = [
  { code: "01", name: "Tew Automation" },
  { code: "8", name: "Pashamylaram" },
  { code: "10", name: "Pathancheru" }
];

export default function BOM() {
  const [goods, setGoods] = useState([]);
  const [allBoms, setAllBoms] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [availableItems, setAvailableItems] = useState([]);
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Dropdown selection: "ALL", "ALL_FG", "ALL_SFG", or specific item code (e.g., "FG0016")
  const [selectedFilter, setSelectedFilter] = useState("ALL");

  // Expanded product accordions
  const [expandedAccordions, setExpandedAccordions] = useState({});

  // Expanded tree nodes (for sub-assemblies inside a formulation)
  const [expandedNodes, setExpandedNodes] = useState({});

  // Add / Edit BOM Modal State (BOM only — Item Master is created in SAP)
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false); // false = Add New BOM, true = Edit Existing BOM
  const [formTreeCode, setFormTreeCode] = useState("");
  const [formItemName, setFormItemName] = useState("");
  const [formWarehouse, setFormWarehouse] = useState("01");
  const [formLines, setFormLines] = useState([
    { compType: "raw", itemCode: "", quantity: "", warehouse: "01" }
  ]);
  const [savingBom, setSavingBom] = useState(false);
  const [modalError, setModalError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const ts = Date.now();
      const noStore = { cache: "no-store" };
      const [goodsRes, bomRes, rmRes, availRes, whRes] = await Promise.all([
        fetch(`/api/materials/goods?_t=${ts}`, noStore),
        fetch(`/api/materials/boms/all?_t=${ts}`, noStore),
        fetch(`/api/materials?_t=${ts}`, noStore),
        fetch(`/api/materials/available-items?_t=${ts}`, noStore),
        fetch(`/api/materials/warehouses?_t=${ts}`, noStore)
      ]);

      if (!goodsRes.ok) {
        const errData = await goodsRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to fetch Finished Goods from SAP");
      }
      if (!bomRes.ok) {
        const errData = await bomRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to fetch BOM rows from SAP");
      }

      const goodsData = await goodsRes.json();
      const bomsData = await bomRes.json();
      const rmData = rmRes.ok ? await rmRes.json() : [];
      const availData = availRes.ok ? await availRes.json() : [];
      const whData = whRes.ok ? await whRes.json() : [];

      setGoods(goodsData);
      setAllBoms(bomsData);
      setRawMaterials(rmData);
      setAvailableItems(availData);
      if (Array.isArray(whData) && whData.length > 0) {
        setWarehouses(whData);
      }

      // Auto-expand first finished good if nothing is expanded yet
      setExpandedAccordions(prev =>
        Object.keys(prev).length === 0 && goodsData.length > 0
          ? { [goodsData[0].id]: true }
          : prev
      );
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter goods according to the dropdown selection
  const filteredGoods = goods.filter(g => {
    if (selectedFilter === "ALL") return true;
    if (selectedFilter === "ALL_FG") return g.is_intermediate === 0;
    if (selectedFilter === "ALL_SFG") return g.is_intermediate === 1;
    return g.id === selectedFilter;
  });

  const handleFilterChange = (e) => {
    const val = e.target.value;
    setSelectedFilter(val);

    if (val !== "ALL" && val !== "ALL_FG" && val !== "ALL_SFG") {
      setExpandedAccordions({ [val]: true });
      const subNodes = {};
      allBoms
        .filter(b => b.finished_good_id === val && b.child_good_id)
        .forEach(b => {
          subNodes[b.child_good_id] = true;
        });
      setExpandedNodes(prev => ({ ...prev, ...subNodes }));
    }
  };

  const toggleExpand = (goodId) => {
    setExpandedNodes(prev => ({ ...prev, [goodId]: !prev[goodId] }));
  };

  const toggleAccordion = (goodId) => {
    setExpandedAccordions(prev => ({ ...prev, [goodId]: !prev[goodId] }));
  };

  const expandAll = () => {
    const allAccordionIds = {};
    const allNodeIds = {};
    filteredGoods.forEach(g => {
      allAccordionIds[g.id] = true;
    });
    goods.forEach(g => {
      allNodeIds[g.id] = true;
    });
    allBoms.forEach(b => {
      if (b.child_good_id) {
        allNodeIds[b.child_good_id] = true;
      }
    });
    setExpandedAccordions(allAccordionIds);
    setExpandedNodes(allNodeIds);
  };

  const collapseAll = () => {
    setExpandedAccordions({});
    setExpandedNodes({});
  };

  // Recursive BOM cost calculator for both Production Standard Cost and Last Purchase Price
  const getBOMCostAndItems = (goodId, requestedQty = null, visited = new Set(), parentShare = 1) => {
    if (visited.has(goodId)) {
      return {
        items: [],
        totalRawQty: 0,
        produceQty: 0,
        stdUnitCost: 0,
        purUnitCost: 0
      };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(goodId);

    const items = allBoms.filter(b => b.finished_good_id === goodId);
    const totalRawQty = items.reduce((sum, b) => sum + parseFloat(b.quantity_required || 0), 0);

    const produceQty = requestedQty !== null ? requestedQty : totalRawQty;

    let stdUnitCost = 0;
    let purUnitCost = 0;

    const renderedItems = items.map(item => {
      const rawQty = parseFloat(item.quantity_required || 0);
      const localShare = totalRawQty > 0 ? rawQty / totalRawQty : 0;
      const effectiveShare = parentShare * localShare;
      const actualQty = localShare * produceQty;

      if (item.raw_material_id) {
        const stdUnitRate = parseFloat(item.prod_std_cost || 0);
        const purUnitRate = parseFloat(item.last_purchase_cost ?? item.raw_cost ?? 0);

        const localStdCostPerKg = localShare * stdUnitRate;
        const localPurCostPerKg = localShare * purUnitRate;

        const stdCostPerKg = effectiveShare * stdUnitRate;
        const purCostPerKg = effectiveShare * purUnitRate;

        stdUnitCost += localStdCostPerKg;
        purUnitCost += localPurCostPerKg;

        return {
          ...item,
          type: "raw",
          code: item.item_code || item.raw_material_id,
          name: item.raw_name,
          stdUnitRate,
          purUnitRate,
          stdCostPerKg,
          purCostPerKg,
          uom: item.raw_uom || "Kg",
          actualQty,
          rawQty,
          localShare,
          effectiveShare
        };
      }

      if (item.child_good_id) {
        const childData = getBOMCostAndItems(item.child_good_id, actualQty, nextVisited, effectiveShare);
        const hasChildBom = childData.items.length > 0;

        const fallbackStdRate = parseFloat(item.prod_std_cost || 0);
        const fallbackPurRate = parseFloat(item.last_purchase_cost ?? item.raw_cost ?? 0);

        const stdUnitRate = hasChildBom ? childData.stdUnitCost : fallbackStdRate;
        const purUnitRate = hasChildBom ? childData.purUnitCost : fallbackPurRate;

        const localStdCostPerKg = localShare * stdUnitRate;
        const localPurCostPerKg = localShare * purUnitRate;

        const stdCostPerKg = effectiveShare * stdUnitRate;
        const purCostPerKg = effectiveShare * purUnitRate;

        stdUnitCost += localStdCostPerKg;
        purUnitCost += localPurCostPerKg;

        return {
          ...item,
          type: "good",
          code: item.item_code || item.child_good_id,
          name: item.child_name,
          stdUnitRate,
          purUnitRate,
          stdCostPerKg,
          purCostPerKg,
          actualQty,
          rawQty,
          localShare,
          effectiveShare,
          childData,
          uom: item.raw_uom || "Kg"
        };
      }

      return null;
    }).filter(Boolean);

    return {
      items: renderedItems,
      totalRawQty,
      produceQty,
      stdUnitCost,
      purUnitCost
    };
  };

  // --- Open Modal for Adding a New BOM (for an existing SAP Item Master) ---
  const openAddBomModal = () => {
    setEditMode(false);
    setModalError(null);
    const defaultWh = warehouses[0]?.code || "01";
    const itemsWithoutBom = availableItems.filter(i => i.has_bom === 0);
    const defaultItem = itemsWithoutBom[0] || availableItems[0] || null;

    setFormTreeCode(defaultItem ? defaultItem.code : "");
    setFormItemName(defaultItem ? defaultItem.name : "");
    setFormWarehouse(defaultWh);
    setFormLines([
      {
        compType: "raw",
        itemCode: rawMaterials[0]?.code || "",
        quantity: "",
        warehouse: defaultWh
      }
    ]);
    setShowModal(true);
  };

  // --- Open Modal for Editing an Existing BOM ---
  const openEditBomModal = (g, e) => {
    if (e) e.stopPropagation();
    setEditMode(true);
    setModalError(null);
    const defaultWh = g.warehouse || warehouses[0]?.code || "01";
    setFormTreeCode(g.code);
    setFormItemName(g.name);
    setFormWarehouse(defaultWh);

    const existingLines = allBoms
      .filter(b => b.finished_good_id === g.id)
      .map(b => ({
        compType: b.child_good_id ? "sfg" : "raw",
        itemCode: b.item_code || b.raw_material_id || b.child_good_id || "",
        quantity: String(b.quantity_required ?? ""),
        warehouse: b.warehouse || defaultWh
      }));

    setFormLines(
      existingLines.length > 0
        ? existingLines
        : [{ compType: "raw", itemCode: rawMaterials[0]?.code || "", quantity: "", warehouse: defaultWh }]
    );
    setShowModal(true);
  };

  const handleHeaderWarehouseChange = (newWh) => {
    const oldWh = formWarehouse;
    setFormWarehouse(newWh);
    setFormLines(prev =>
      prev.map(line =>
        !line.warehouse || line.warehouse === oldWh
          ? { ...line, warehouse: newWh }
          : line
      )
    );
  };

  const handleAddLine = () => {
    setFormLines(prev => [
      ...prev,
      {
        compType: "raw",
        itemCode: rawMaterials[0]?.code || "",
        quantity: "",
        warehouse: formWarehouse || warehouses[0]?.code || "01"
      }
    ]);
  };

  const handleRemoveLine = (idx) => {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx, field, val) => {
    setFormLines(prev =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        if (field === "compType") {
          const defaultCode =
            val === "raw"
              ? rawMaterials[0]?.code || ""
              : availableItems.find(a => a.is_intermediate === 1 && a.code !== formTreeCode)?.code || "";
          return { ...line, compType: val, itemCode: defaultCode };
        }
        return { ...line, [field]: val };
      })
    );
  };

  const handleSaveBom = async (e) => {
    e.preventDefault();
    setModalError(null);
    setStatusMsg(null);

    const cleanTreeCode = String(formTreeCode || "").trim();
    if (!cleanTreeCode) {
      setModalError("Please select a Parent Item from SAP Item Master.");
      return;
    }

    if (!formWarehouse) {
      setModalError("Please select a Warehouse.");
      return;
    }

    const validLines = formLines
      .map(l => ({
        itemCode: String(l.itemCode || "").trim(),
        quantity: parseFloat(l.quantity),
        warehouse: String(l.warehouse || formWarehouse || "01").trim()
      }))
      .filter(l => l.itemCode && !isNaN(l.quantity) && l.quantity > 0);

    if (validLines.length === 0) {
      setModalError("Please add at least one component with a quantity greater than 0.");
      return;
    }

    const totalLineQty = validLines.reduce((sum, l) => sum + l.quantity, 0);

    setSavingBom(true);
    try {
      let res;
      if (editMode) {
        res = await fetch(`/api/materials/bom/${encodeURIComponent(cleanTreeCode)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity: totalLineQty,
            warehouse: formWarehouse,
            lines: validLines
          })
        });
      } else {
        res = await fetch("/api/materials/bom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            treeCode: cleanTreeCode,
            quantity: totalLineQty,
            warehouse: formWarehouse,
            lines: validLines
          })
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to save BOM via SAP Service Layer");
      }

      setShowModal(false);
      setStatusMsg(
        data.message ||
          `Successfully ${editMode ? "updated" : "created"} BOM for ${cleanTreeCode} (Warehouse ${formWarehouse}) in SAP via Service Layer`
      );
      await fetchData();
      setExpandedAccordions(prev => ({ ...prev, [cleanTreeCode]: true }));
    } catch (err) {
      console.error(err);
      setModalError(err.message);
    } finally {
      setSavingBom(false);
    }
  };

  const renderRecursiveBOM = (bomData, level = 0) => {
    return bomData.items.map(b => {
      const hasSubItems = b.type === "good" && b.childData && b.childData.items && b.childData.items.length > 0;
      const isNodeExpanded = !!expandedNodes[b.child_good_id];

      return (
        <Fragment key={`${b.id}_lvl${level}`}>
          <tr
            className={`border-b border-black/[0.06] transition-colors ${
              level === 0
                ? "bg-white hover:bg-[#faf9f7]"
                : "bg-[#faf9f7] hover:bg-[#f4f2ef]/80"
            }`}
          >
            <td className="px-4 py-3 text-sm">
              <div style={{ marginLeft: `${level * 1.75}rem` }} className="flex items-center gap-2.5 flex-wrap">
                {b.type === "good" && (
                  <button
                    onClick={() => toggleExpand(b.child_good_id)}
                    title={isNodeExpanded ? "Collapse Sub-Assembly" : "Expand Sub-Assembly"}
                    className="w-5 h-5 flex items-center justify-center text-white bg-[#006D77] hover:bg-[#00555d] rounded-[3px] font-bold text-xs transition-colors cursor-pointer"
                  >
                    {isNodeExpanded ? "−" : "+"}
                  </button>
                )}
                <span className="font-mono-code text-[11.5px] font-semibold px-2 py-0.5 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.09]">
                  {b.code}
                </span>
                <span className={level > 0 ? "text-[#444444] font-medium" : "text-[#1a1a1a] font-semibold"}>
                  {b.name}
                </span>
                {b.warehouse && (
                  <span className="font-mono-code text-[10.5px] font-medium bg-[#faf9f7] text-[#6b6863] px-1.5 py-0.5 rounded-[3px] border border-black/[0.08]">
                    WH: {b.warehouse}
                  </span>
                )}
                {b.type === "good" && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] bg-[#006D77]/10 text-[#006D77] px-2 py-0.5 rounded-[3px] border border-[#006D77]/25">
                    {b.phantom === "Y" ? "Phantom SFG" : "Sub-Assembly"}
                  </span>
                )}
                {b.type === "good" && !hasSubItems && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-[3px] border border-amber-200">
                    No BOM in SAP
                  </span>
                )}
              </div>
            </td>

            <td className="px-4 py-3 text-right font-mono-code text-xs sm:text-sm">
              <span className={level > 0 ? "text-[#6b6863]" : "font-semibold text-[#1a1a1a]"}>
                {b.actualQty.toFixed(4)} <span className="text-[11px] text-[#8a8780] font-normal">{b.uom}</span>
                {level > 0 && Math.abs(b.actualQty - b.rawQty) > 0.0001 && (
                  <span className="ml-1 text-[11px] text-[#8a8780]" title="SAP Sub-Assembly Recipe Qty">
                    (Recipe: {b.rawQty.toFixed(4)})
                  </span>
                )}
              </span>
            </td>

            <td className="px-4 py-3 text-right font-mono-code font-semibold text-xs sm:text-sm text-[#444444] bg-[#faf9f7]/60">
              {(b.effectiveShare * 100).toFixed(2)}%
            </td>

            {/* Production Standard Cost Calculation */}
            <td className="px-4 py-3 text-right font-mono-code text-xs sm:text-sm text-[#444444] bg-[#c8102e]/[0.02]">
              ₹{b.stdUnitRate.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-mono-code font-bold text-xs sm:text-sm text-[#c8102e] bg-[#c8102e]/[0.05]">
              ₹{b.stdCostPerKg.toFixed(2)}
            </td>

            {/* Last Purchase Price Calculation */}
            <td className="px-4 py-3 text-right font-mono-code text-xs sm:text-sm text-[#444444] bg-[#006D77]/[0.02]">
              ₹{b.purUnitRate.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-mono-code font-bold text-xs sm:text-sm text-[#006D77] bg-[#006D77]/[0.05]">
              ₹{b.purCostPerKg.toFixed(2)}
            </td>
          </tr>

          {b.type === "good" && isNodeExpanded && hasSubItems && (
            renderRecursiveBOM(b.childData, level + 1)
          )}
        </Fragment>
      );
    });
  };

  const finishedGoodsList = goods.filter(g => g.is_intermediate === 0);
  const subAssembliesList = goods.filter(g => g.is_intermediate === 1);
  const sfgOptions = availableItems.filter(i => i.is_intermediate === 1 && i.code !== formTreeCode);

  const modalTotalQty = formLines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0), 0);

  return (
    <div className="space-y-6 pb-20">
      {/* Architectural Section Header & Stats */}
      <div className="rp-card p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-black/[0.08]">
          <div>
            <div className="sec-label mb-2">SAP HANA · PRODUCT TREES (OITT)</div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a1a1a] tracking-[-0.02em]">
              Formulations &amp; <span className="italic-accent">Costing</span>
            </h1>
            <p className="text-xs sm:text-sm text-[#6b6863] mt-1.5 max-w-2xl">
              Multi-level formulation engine normalizing batch recipes to 1.0000 Kg unit cost across{" "}
              <span className="font-semibold text-[#c8102e]">Production Standard Cost</span> and{" "}
              <span className="font-semibold text-[#006D77]">Last Purchase Price</span>.
            </p>
          </div>

          {/* Mini Architectural Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-black/[0.08] border border-black/[0.08] rounded-[4px] overflow-hidden shrink-0">
            <div className="bg-[#faf9f7] px-4 py-2.5">
              <div className="font-playfair text-xl font-bold text-[#1a1a1a] leading-tight">
                {goods.length}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b6863]">
                Active BOMs
              </div>
            </div>
            <div className="bg-[#faf9f7] px-4 py-2.5">
              <div className="font-playfair text-xl font-bold text-[#c8102e] leading-tight">
                {finishedGoodsList.length}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b6863]">
                Finished Goods
              </div>
            </div>
            <div className="bg-[#faf9f7] px-4 py-2.5">
              <div className="font-playfair text-xl font-bold text-[#006D77] leading-tight">
                {subAssembliesList.length}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b6863]">
                Sub-Assemblies
              </div>
            </div>
            <div className="bg-[#faf9f7] px-4 py-2.5">
              <div className="font-playfair text-xl font-bold text-[#1a1a1a] leading-tight">
                {rawMaterials.length}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b6863]">
                Raw Materials
              </div>
            </div>
          </div>
        </div>

        {/* Filter & Action Toolbar */}
        <div className="pt-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="fg-filter"
              className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b6863] whitespace-nowrap"
            >
              Filter Formulation:
            </label>
            <select
              id="fg-filter"
              value={selectedFilter}
              onChange={handleFilterChange}
              className="border border-black/[0.15] rounded-[4px] px-3.5 py-2 text-xs sm:text-sm bg-white font-semibold text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none min-w-[260px]"
            >
              <option value="ALL">All BOMs ({goods.length})</option>
              <option value="ALL_FG">All Finished Goods ({finishedGoodsList.length})</option>
              <option value="ALL_SFG">All Sub-Assemblies ({subAssembliesList.length})</option>
              <optgroup label="Finished Goods (FG)">
                {finishedGoodsList.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.code} — {g.name}
                  </option>
                ))}
              </optgroup>
              {subAssembliesList.length > 0 && (
                <optgroup label="Sub-Assemblies (SFG)">
                  {subAssembliesList.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button onClick={openAddBomModal} className="rp-btn rp-btn-red">
              + Add BOM
            </button>
            <button onClick={expandAll} className="rp-btn rp-btn-outline">
              Expand All
            </button>
            <button onClick={collapseAll} className="rp-btn rp-btn-outline">
              Collapse All
            </button>
            <button onClick={fetchData} className="rp-btn rp-btn-dark">
              Refresh SAP Data
            </button>
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

      {loading && (
        <div className="rp-card p-14 text-center">
          <div className="inline-block w-6 h-6 border-2 border-[#c8102e] border-t-transparent rounded-full animate-spin mb-3" />
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#6b6863]">
            Loading Formulations from SAP Business One HANA...
          </div>
        </div>
      )}

      {error && (
        <div className="bg-[#c8102e]/[0.05] border-l-4 border-[#c8102e] border border-[#c8102e]/20 text-[#1a1a1a] p-4 rounded-[4px] flex items-center justify-between">
          <div className="text-xs sm:text-sm">
            <span className="font-bold uppercase tracking-[0.06em] text-[#c8102e] mr-2">
              SAP Error:
            </span>
            {error}
          </div>
          <button onClick={fetchData} className="rp-btn rp-btn-red py-1.5 px-3">
            Retry
          </button>
        </div>
      )}

      {/* Accordion List of Products */}
      {!loading && !error && (
        <div className="space-y-3.5">
          {filteredGoods.length === 0 ? (
            <div className="rp-card p-10 text-center text-sm text-[#6b6863]">
              No BOMs found matching the selected filter.
            </div>
          ) : (
            filteredGoods.map(g => {
              const isSelected = !!expandedAccordions[g.id];
              const bomData = getBOMCostAndItems(g.id);
              const isSfg = g.is_intermediate === 1;

              return (
                <div
                  key={g.id}
                  className={`rp-card overflow-hidden transition-all duration-200 border-l-[3px] ${
                    isSfg ? "border-l-[#006D77]" : "border-l-[#c8102e]"
                  } ${
                    isSelected
                      ? "ring-1 ring-black/[0.12] shadow-[0_6px_20px_rgba(0,0,0,0.06)]"
                      : "hover:shadow-[0_4px_14px_rgba(0,0,0,0.05)]"
                  }`}
                >
                  {/* Accordion Header */}
                  <div
                    onClick={() => toggleAccordion(g.id)}
                    className="w-full px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between cursor-pointer hover:bg-[#faf9f7] transition-colors gap-4"
                  >
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <div
                        className={`w-6 h-6 rounded-[3px] flex items-center justify-center transition-transform ${
                          isSelected
                            ? "rotate-90 bg-[#c8102e] text-white"
                            : "bg-[#f4f2ef] text-[#6b6863]"
                        }`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3.5 w-3.5"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>

                      <span
                        className={`font-mono-code text-xs font-bold px-2.5 py-1 rounded-[3px] border ${
                          isSfg
                            ? "bg-[#006D77]/[0.08] text-[#006D77] border-[#006D77]/20"
                            : "bg-[#c8102e]/[0.07] text-[#c8102e] border-[#c8102e]/20"
                        }`}
                      >
                        {g.code}
                      </span>

                      <span className="font-bold text-base sm:text-lg text-[#1a1a1a] tracking-[-0.01em]">
                        {g.name}
                      </span>

                      {g.warehouse && (
                        <span className="font-mono-code text-[11px] font-semibold bg-[#f4f2ef] text-[#444444] px-2 py-0.5 rounded-[3px] border border-black/[0.08]">
                          WH: {g.warehouse}
                        </span>
                      )}

                      {isSfg && (
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] bg-[#006D77]/10 text-[#006D77] px-2.5 py-0.5 rounded-[3px] border border-[#006D77]/25">
                          {g.phantom === "Y" ? "Phantom Sub-Assembly" : "Sub-Assembly"}
                        </span>
                      )}
                    </div>

                    {/* Right Metrics Strip */}
                    <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-3 lg:pt-0 border-t lg:border-t-0 lg:border-l border-black/[0.08] lg:pl-6 shrink-0">
                      <div className="text-left">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
                          Prod. Std Cost / Kg
                        </div>
                        <div className="font-mono-code font-bold text-[#c8102e] text-sm sm:text-base">
                          ₹{bomData.stdUnitCost.toFixed(2)}
                        </div>
                      </div>

                      <div className="h-7 w-[1px] bg-black/[0.08] hidden sm:block" />

                      <div className="text-left">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
                          Purchase Cost / Kg
                        </div>
                        <div className="font-mono-code font-bold text-[#006D77] text-sm sm:text-base">
                          ₹{bomData.purUnitCost.toFixed(2)}
                        </div>
                      </div>

                      <div className="h-7 w-[1px] bg-black/[0.08] hidden sm:block" />

                      <div className="text-left">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
                          Recipe Qty
                        </div>
                        <div className="font-mono-code font-bold text-[#1a1a1a] text-sm sm:text-base">
                          {bomData.totalRawQty.toFixed(3)} <span className="text-xs font-normal text-[#8a8780]">Kg</span>
                        </div>
                      </div>

                      <button
                        onClick={(e) => openEditBomModal(g, e)}
                        className="rp-btn rp-btn-outline py-1.5 px-3 text-[10.5px]"
                      >
                        Edit BOM
                      </button>
                    </div>
                  </div>

                  {/* Accordion Body */}
                  {isSelected && (
                    <div className="border-t border-black/[0.08] bg-[#faf9f7] p-4 sm:p-5">
                      <div className="bg-white rounded-[4px] border border-black/[0.08] overflow-hidden overflow-x-auto">
                        <table className="min-w-full divide-y divide-black/[0.08]">
                          <thead className="bg-[#f4f2ef]">
                            <tr>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                                Component (SAP Code &amp; Description)
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                                BOM Qty
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                                Normalized %
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.1em] bg-[#c8102e]/[0.04]">
                                Prod. Std Rate
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.1em] bg-[#c8102e]/[0.08]">
                                Prod. Std Cost / Kg
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#006D77] uppercase tracking-[0.1em] bg-[#006D77]/[0.04]">
                                Last Pur. Rate
                              </th>
                              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#006D77] uppercase tracking-[0.1em] bg-[#006D77]/[0.08]">
                                Purchase Cost / Kg
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black/[0.06]">
                            {bomData.items.length === 0 ? (
                              <tr>
                                <td colSpan="7" className="p-8 text-center text-[#6b6863] italic text-sm">
                                  No components found for this BOM in SAP.
                                </td>
                              </tr>
                            ) : (
                              renderRecursiveBOM(bomData)
                            )}
                          </tbody>
                          {bomData.items.length > 0 && (
                            <tfoot className="bg-[#1c1c1c] text-white">
                              <tr>
                                <td className="px-4 py-3.5 text-right text-[11px] font-bold uppercase tracking-[0.1em] text-[#ece8e2]">
                                  Cost / Kg Summary
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono-code font-bold text-white text-sm">
                                  {bomData.totalRawQty.toFixed(4)} Kg
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono-code font-bold text-[#ece8e2] text-sm">
                                  100.00%
                                </td>
                                <td className="px-4 py-3.5 text-right text-xs text-[#8a8780]">
                                  —
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono-code font-bold text-[#ff6b81] text-sm sm:text-base bg-white/[0.04]">
                                  ₹{bomData.stdUnitCost.toFixed(2)} / Kg
                                </td>
                                <td className="px-4 py-3.5 text-right text-xs text-[#8a8780]">
                                  —
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono-code font-bold text-[#4fd1c5] text-sm sm:text-base bg-white/[0.04]">
                                  ₹{bomData.purUnitCost.toFixed(2)} / Kg
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Add / Edit BOM Modal (BOM Only — Item Master is created in SAP) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div className="bg-white rounded-[6px] shadow-2xl border border-black/[0.12] border-t-[3px] border-t-[#c8102e] max-w-4xl w-full p-6 sm:p-7 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-black/[0.08] pb-4">
              <div>
                <div className="sec-label mb-1">
                  {editMode ? "SAP SERVICE LAYER · UPDATE BOM" : "SAP SERVICE LAYER · NEW BOM"}
                </div>
                <h3 className="text-xl font-extrabold text-[#1a1a1a] tracking-[-0.01em]">
                  {editMode ? `Edit BOM — ${formTreeCode} (${formItemName})` : "Configure Product Tree (BOM)"}
                </h3>
                <p className="text-xs text-[#6b6863] mt-0.5">
                  Select an existing SAP Item Master (<code className="font-mono-code bg-[#f4f2ef] px-1.5 py-0.5 rounded-[3px]">OITM</code>) and post its formulation to{" "}
                  <code className="font-mono-code bg-[#f4f2ef] px-1.5 py-0.5 rounded-[3px]">/ProductTrees</code>
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-[4px] bg-[#f4f2ef] hover:bg-[#ece8e2] text-[#1a1a1a] flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="bg-[#c8102e]/[0.06] border-l-4 border-[#c8102e] text-[#1a1a1a] px-4 py-3 rounded-[4px] text-xs sm:text-sm">
                <span className="font-bold text-[#c8102e] uppercase tracking-[0.06em] mr-1.5">Error:</span>
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveBom} className="space-y-5">
              {/* Parent Product (Existing SAP Item Only) & Warehouse Section */}
              <div className="bg-[#faf9f7] p-4 rounded-[4px] border border-black/[0.08]">
                {editMode ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-[10.5px] font-bold text-[#6b6863] uppercase tracking-[0.1em] mb-1.5">
                        Parent Product (SAP Item Master)
                      </label>
                      <div className="px-3.5 py-2 bg-white border border-black/[0.12] rounded-[4px] text-sm font-bold text-[#1a1a1a] font-mono-code">
                        {formTreeCode} — <span className="font-sans font-semibold">{formItemName}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold text-[#6b6863] uppercase tracking-[0.1em] mb-1.5">
                        BOM Header Warehouse *
                      </label>
                      <select
                        value={formWarehouse}
                        onChange={e => handleHeaderWarehouseChange(e.target.value)}
                        className="w-full border border-black/[0.15] rounded-[4px] px-3 py-2 text-sm bg-white font-semibold text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                        required
                      >
                        {warehouses.map(wh => (
                          <option key={wh.code} value={wh.code}>
                            {wh.code} — {wh.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-[10.5px] font-bold text-[#6b6863] uppercase tracking-[0.1em] mb-1.5">
                        Parent Item from SAP Item Master (FG / SFG) *
                      </label>
                      <select
                        value={formTreeCode}
                        onChange={e => {
                          const code = e.target.value;
                          const selected = availableItems.find(i => i.code === code);
                          setFormTreeCode(code);
                          setFormItemName(selected?.name || "");
                          const existingLines = allBoms
                            .filter(b => b.finished_good_id === code)
                            .map(b => ({
                              compType: b.child_good_id ? "sfg" : "raw",
                              itemCode: b.item_code || b.raw_material_id || b.child_good_id || "",
                              quantity: String(b.quantity_required ?? ""),
                              warehouse: b.warehouse || formWarehouse || "01"
                            }));
                          if (existingLines.length > 0) {
                            setFormLines(existingLines);
                          }
                        }}
                        className="w-full border border-black/[0.15] rounded-[4px] px-3 py-2 text-sm bg-white font-semibold text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                        required
                      >
                        <option value="">-- Select FG or Semi-Finished Good --</option>
                        <optgroup label={`Finished Goods (FG — ${availableItems.filter(i => !i.is_intermediate).length})`}>
                          {availableItems.filter(i => !i.is_intermediate).map(item => (
                            <option key={item.code} value={item.code}>
                              {item.code} — {item.name} {item.has_bom ? "(Has BOM)" : "(No BOM Yet)"}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label={`Semi-Finished Goods (SFG — ${availableItems.filter(i => i.is_intermediate).length})`}>
                          {availableItems.filter(i => i.is_intermediate).map(item => (
                            <option key={item.code} value={item.code}>
                              {item.code} — {item.name} {item.has_bom ? "(Has BOM)" : "(No BOM Yet)"}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold text-[#6b6863] uppercase tracking-[0.1em] mb-1.5">
                        BOM Header Warehouse *
                      </label>
                      <select
                        value={formWarehouse}
                        onChange={e => handleHeaderWarehouseChange(e.target.value)}
                        className="w-full border border-black/[0.15] rounded-[4px] px-3 py-2 text-sm bg-white font-semibold text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                        required
                      >
                        {warehouses.map(wh => (
                          <option key={wh.code} value={wh.code}>
                            {wh.code} — {wh.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* BOM Component Lines */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-[0.08em] text-[#1a1a1a]">
                    Formulation Components (Total Recipe Qty:{" "}
                    <span className="font-mono-code text-[#c8102e]">{modalTotalQty.toFixed(4)} Kg</span>)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="rp-btn rp-btn-outline py-1.5 px-3 text-[10.5px]"
                  >
                    + Add Component Line
                  </button>
                </div>

                <div className="border border-black/[0.1] rounded-[4px] overflow-hidden">
                  <table className="min-w-full divide-y divide-black/[0.08] text-sm">
                    <thead className="bg-[#f4f2ef]">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          Type
                        </th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          Component Item
                        </th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          Warehouse
                        </th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          BOM Qty (Kg)
                        </th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          Share %
                        </th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                          Remove
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06] bg-white">
                      {formLines.map((line, idx) => {
                        const qty = parseFloat(line.quantity) || 0;
                        const pct = modalTotalQty > 0 ? (qty / modalTotalQty) * 100 : 0;

                        return (
                          <tr key={idx} className="hover:bg-[#faf9f7]">
                            <td className="px-3 py-2">
                              <select
                                value={line.compType}
                                onChange={e => handleLineChange(idx, "compType", e.target.value)}
                                className="border border-black/[0.15] rounded-[4px] px-2.5 py-1.5 text-xs bg-white font-semibold text-[#1a1a1a]"
                              >
                                <option value="raw">Raw Material (RM)</option>
                                <option value="sfg">Sub-Assembly (SFG)</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.itemCode}
                                onChange={e => handleLineChange(idx, "itemCode", e.target.value)}
                                className="w-full border border-black/[0.15] rounded-[4px] px-2.5 py-1.5 text-xs bg-white font-medium text-[#1a1a1a]"
                              >
                                <option value="">-- Select Component --</option>
                                {line.compType === "raw"
                                  ? rawMaterials.map(rm => (
                                      <option key={rm.code} value={rm.code}>
                                        {rm.code} — {rm.name} (Std: ₹{Number(rm.prod_std_cost || 0).toFixed(2)} | Pur: ₹{Number(rm.last_purchase_cost || 0).toFixed(2)})
                                      </option>
                                    ))
                                  : sfgOptions.map(sfg => (
                                      <option key={sfg.code} value={sfg.code}>
                                        {sfg.code} — {sfg.name}
                                      </option>
                                    ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.warehouse || formWarehouse || "01"}
                                onChange={e => handleLineChange(idx, "warehouse", e.target.value)}
                                className="border border-black/[0.15] rounded-[4px] px-2.5 py-1.5 text-xs bg-white font-medium text-[#1a1a1a]"
                              >
                                {warehouses.map(wh => (
                                  <option key={wh.code} value={wh.code}>
                                    {wh.code} — {wh.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                value={line.quantity}
                                onChange={e => handleLineChange(idx, "quantity", e.target.value)}
                                placeholder="0.0000"
                                className="w-28 border border-black/[0.15] rounded-[4px] px-2.5 py-1.5 text-right text-xs font-mono-code font-bold text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                                required
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono-code font-semibold text-[#c8102e] text-xs">
                              {pct.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-center">
                              {formLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLine(idx)}
                                  className="text-[#c8102e] hover:text-[#a00d24] font-bold text-xs px-2 py-1 cursor-pointer"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-black/[0.08] pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rp-btn rp-btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBom}
                  className="rp-btn rp-btn-red"
                >
                  {savingBom
                    ? "Saving to SAP via Service Layer..."
                    : editMode
                    ? "Update BOM in SAP (Service Layer)"
                    : "Create BOM in SAP (Service Layer)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
