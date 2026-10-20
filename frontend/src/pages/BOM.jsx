import { useState, useEffect, Fragment } from "react";

export default function BOM() {
  const [goods, setGoods] = useState([]);
  const [allBoms, setAllBoms] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [availableItems, setAvailableItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Dropdown selection: "ALL", "ALL_FG", "ALL_SFG", or specific item code (e.g., "FG0016")
  const [selectedFilter, setSelectedFilter] = useState("ALL");

  // Expanded product accordions
  const [expandedAccordions, setExpandedAccordions] = useState({});

  // Expanded tree nodes (for sub-assemblies inside a formulation)
  const [expandedNodes, setExpandedNodes] = useState({});

  // Add / Edit BOM Modal State
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false); // false = Add New BOM, true = Edit Existing BOM
  const [parentMode, setParentMode] = useState("existing"); // "existing" | "new"
  const [formTreeCode, setFormTreeCode] = useState("");
  const [formItemName, setFormItemName] = useState("");
  const [formItemGroup, setFormItemGroup] = useState(102); // 102 = FG, 107 = SFG
  const [formIsPhantom, setFormIsPhantom] = useState(false);
  const [formWarehouse, setFormWarehouse] = useState("01");
  const [formLines, setFormLines] = useState([
    { compType: "raw", itemCode: "", quantity: "" }
  ]);
  const [savingBom, setSavingBom] = useState(false);
  const [modalError, setModalError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [goodsRes, bomRes, rmRes, availRes] = await Promise.all([
        fetch("/api/materials/goods"),
        fetch("/api/materials/boms/all"),
        fetch("/api/materials"),
        fetch("/api/materials/available-items")
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

      setGoods(goodsData);
      setAllBoms(bomsData);
      setRawMaterials(rmData);
      setAvailableItems(availData);

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

  // --- Open Modal for Adding a New BOM ---
  const openAddBomModal = () => {
    setEditMode(false);
    setModalError(null);
    const itemsWithoutBom = availableItems.filter(i => i.has_bom === 0);
    if (itemsWithoutBom.length > 0) {
      setParentMode("existing");
      setFormTreeCode(itemsWithoutBom[0].code);
      setFormItemName(itemsWithoutBom[0].name);
    } else {
      setParentMode("new");
      setFormTreeCode("");
      setFormItemName("");
    }
    setFormItemGroup(102);
    setFormIsPhantom(false);
    setFormWarehouse("01");
    setFormLines([
      {
        compType: "raw",
        itemCode: rawMaterials[0]?.code || "",
        quantity: ""
      }
    ]);
    setShowModal(true);
  };

  // --- Open Modal for Editing an Existing BOM ---
  const openEditBomModal = (g, e) => {
    if (e) e.stopPropagation();
    setEditMode(true);
    setModalError(null);
    setParentMode("existing");
    setFormTreeCode(g.code);
    setFormItemName(g.name);
    setFormWarehouse(g.warehouse || "01");

    const existingLines = allBoms
      .filter(b => b.finished_good_id === g.id)
      .map(b => ({
        compType: b.child_good_id ? "sfg" : "raw",
        itemCode: b.item_code || b.raw_material_id || b.child_good_id || "",
        quantity: String(b.quantity_required ?? "")
      }));

    setFormLines(
      existingLines.length > 0
        ? existingLines
        : [{ compType: "raw", itemCode: rawMaterials[0]?.code || "", quantity: "" }]
    );
    setShowModal(true);
  };

  const handleAddLine = () => {
    setFormLines(prev => [
      ...prev,
      { compType: "raw", itemCode: rawMaterials[0]?.code || "", quantity: "" }
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
      setModalError("Please select or enter a Parent Product Code.");
      return;
    }

    const validLines = formLines
      .map(l => ({
        itemCode: String(l.itemCode || "").trim(),
        quantity: parseFloat(l.quantity)
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
            warehouse: formWarehouse || "01",
            lines: validLines
          })
        });
      } else {
        res = await fetch("/api/materials/bom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            createNewItem: parentMode === "new",
            treeCode: cleanTreeCode,
            itemName: formItemName,
            itemGroup: Number(formItemGroup),
            isPhantom: formIsPhantom,
            quantity: totalLineQty,
            warehouse: formWarehouse || "01",
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
          `Successfully ${editMode ? "updated" : "created"} BOM for ${cleanTreeCode} in SAP via Service Layer`
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
          <tr className={`hover:bg-blue-50/60 border-b transition-colors ${level === 0 ? "bg-white" : "bg-slate-50/80"}`}>
            <td className="px-4 py-3 font-medium text-sm md:text-base">
              <div style={{ marginLeft: `${level * 2}rem` }} className="flex items-center gap-2 flex-wrap">
                {b.type === "good" && (
                  <button
                    onClick={() => toggleExpand(b.child_good_id)}
                    title={isNodeExpanded ? "Collapse Sub-Assembly" : "Expand Sub-Assembly"}
                    className="w-6 h-6 flex items-center justify-center text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-full font-bold text-sm transition-colors"
                  >
                    {isNodeExpanded ? "−" : "+"}
                  </button>
                )}
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">
                  {b.code}
                </span>
                <span className={level > 0 ? "text-gray-700" : "text-gray-900 font-semibold"}>
                  {b.name}
                </span>
                {b.type === "good" && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium border border-purple-200">
                    {b.phantom === "Y" ? "Phantom Sub-Assembly" : "Sub-Assembly"}
                  </span>
                )}
                {b.type === "good" && !hasSubItems && (
                  <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
                    No BOM in SAP
                  </span>
                )}
              </div>
            </td>

            <td className="px-4 py-3 text-right">
              <span className={level > 0 ? "text-gray-600 text-sm" : "font-semibold text-gray-900"}>
                {b.actualQty.toFixed(4)} <span className="text-xs text-gray-400 font-normal">{b.uom}</span>
                {level > 0 && Math.abs(b.actualQty - b.rawQty) > 0.0001 && (
                  <span className="ml-1 text-xs text-gray-400" title="SAP Sub-Assembly Recipe Qty">
                    (Recipe: {b.rawQty.toFixed(4)})
                  </span>
                )}
              </span>
            </td>

            <td className="px-4 py-3 text-right font-medium text-blue-600 bg-blue-50/20">
              {(b.effectiveShare * 100).toFixed(2)}%
            </td>

            {/* Production Standard Cost Calculation */}
            <td className="px-4 py-3 text-right text-indigo-700 text-sm bg-indigo-50/15">
              ₹{b.stdUnitRate.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-semibold text-indigo-900 text-sm bg-indigo-50/30">
              ₹{b.stdCostPerKg.toFixed(2)}
            </td>

            {/* Last Purchase Price Calculation */}
            <td className="px-4 py-3 text-right text-blue-700 text-sm bg-blue-50/15">
              ₹{b.purUnitRate.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-semibold text-blue-900 text-sm bg-blue-50/30">
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
  const itemsWithoutBom = availableItems.filter(i => i.has_bom === 0);
  const sfgOptions = availableItems.filter(i => i.is_intermediate === 1 && i.code !== formTreeCode);

  const modalTotalQty = formLines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0), 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      {/* Top Header & Controls */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">SAP Bill of Materials (BOM)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Calculates formulation cost per Kg based on <span className="font-semibold text-indigo-700">Production Standard Cost</span> &amp; <span className="font-semibold text-blue-700">Last Purchase Price</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Dropdown for Finished Goods & All */}
          <div className="flex items-center gap-2">
            <label htmlFor="fg-filter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Filter Product:
            </label>
            <select
              id="fg-filter"
              value={selectedFilter}
              onChange={handleFilterChange}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium text-gray-800 shadow-xs focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[220px]"
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

          <button
            onClick={openAddBomModal}
            className="px-4 py-2 bg-blue-600 text-white shadow-sm text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
          >
            + Add BOM
          </button>

          <button
            onClick={expandAll}
            className="px-3.5 py-2 bg-blue-50 text-blue-700 border border-blue-200 shadow-xs text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3.5 py-2 bg-white text-gray-700 border border-gray-300 shadow-xs text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Collapse All
          </button>
          <button
            onClick={fetchData}
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

      {loading && (
        <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center text-gray-500">
          Loading BOMs from SAP Business One...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="font-semibold">Error loading SAP BOMs:</span> {error}
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Accordion List of Products */}
      {!loading && !error && (
        <div className="space-y-3">
          {filteredGoods.length === 0 ? (
            <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-500">
              No BOMs found matching the selected filter.
            </div>
          ) : (
            filteredGoods.map(g => {
              const isSelected = !!expandedAccordions[g.id];
              const bomData = getBOMCostAndItems(g.id);

              return (
                <div
                  key={g.id}
                  className={`bg-white rounded-xl shadow-sm border transition-all duration-200 overflow-hidden ${
                    isSelected ? "border-blue-300 ring-1 ring-blue-300" : "border-gray-200"
                  }`}
                >
                  {/* Accordion Header */}
                  <div
                    onClick={() => toggleAccordion(g.id)}
                    className="w-full p-4 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors gap-3"
                  >
                    <div className="flex flex-wrap items-center gap-3 w-full justify-between">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className={`transform transition-transform ${isSelected ? "rotate-90 text-blue-600" : "text-gray-400"}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>

                        <span className="font-mono text-sm font-bold px-2.5 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">
                          {g.code}
                        </span>

                        <span className="font-semibold text-lg text-gray-800">{g.name}</span>

                        {g.is_intermediate === 1 && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full font-medium border border-purple-200">
                            {g.phantom === "Y" ? "Phantom Sub-Assembly" : "Sub-Assembly"}
                          </span>
                        )}
                      </div>

                      {/* Stats Block: Production Standard Cost & Purchase Price Cost (No Batch Cost) */}
                      <div className="flex items-center gap-5 border-l-2 pl-4 border-gray-200">
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-indigo-600 uppercase font-bold tracking-wider">
                            Prod. Std Cost / Kg
                          </div>
                          <div className="font-bold text-indigo-800 text-sm sm:text-base">
                            ₹{bomData.stdUnitCost.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-blue-600 uppercase font-bold tracking-wider">
                            Purchase Price Cost / Kg
                          </div>
                          <div className="font-bold text-blue-800 text-sm sm:text-base">
                            ₹{bomData.purUnitCost.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-bold tracking-wider">
                            BOM Qty
                          </div>
                          <div className="font-bold text-emerald-600 text-sm sm:text-base">
                            {bomData.totalRawQty.toFixed(3)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => openEditBomModal(g, e)}
                          className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                        >
                          Edit BOM
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Accordion Body */}
                  {isSelected && (
                    <div className="border-t border-gray-100 bg-gray-50 p-4 sm:p-5">
                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Component (SAP Code &amp; Description)
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                BOM Qty
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Normalized %
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-indigo-700 uppercase tracking-wider bg-indigo-50/40">
                                Prod. Std Rate
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-indigo-900 uppercase tracking-wider bg-indigo-50/70">
                                Prod. Std Cost / Kg
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-blue-700 uppercase tracking-wider bg-blue-50/40">
                                Last Pur. Rate
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-blue-900 uppercase tracking-wider bg-blue-50/70">
                                Purchase Cost / Kg
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {bomData.items.length === 0 ? (
                              <tr>
                                <td colSpan="7" className="p-8 text-center text-gray-500 italic">
                                  No components found for this BOM in SAP.
                                </td>
                              </tr>
                            ) : (
                              renderRecursiveBOM(bomData)
                            )}
                          </tbody>
                          {bomData.items.length > 0 && (
                            <tfoot className="bg-gray-50 border-t border-gray-200">
                              <tr>
                                <td className="px-4 py-3.5 text-right font-bold text-gray-800">
                                  Cost / Kg Summary:
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-emerald-700 text-base">
                                  {bomData.totalRawQty.toFixed(4)} Kg
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-blue-700">
                                  100.00%
                                </td>
                                <td className="px-4 py-3.5 text-right text-xs font-medium text-indigo-500 bg-indigo-50/30">
                                  —
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-indigo-900 text-base bg-indigo-50/60">
                                  ₹{bomData.stdUnitCost.toFixed(2)} / Kg
                                </td>
                                <td className="px-4 py-3.5 text-right text-xs font-medium text-blue-500 bg-blue-50/30">
                                  —
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-blue-900 text-base bg-blue-50/60">
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

      {/* Add / Edit BOM Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-3xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">
                  {editMode ? `Edit BOM — ${formTreeCode} (${formItemName})` : "Add New BOM in SAP"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Posts directly to SAP Business One <code className="bg-gray-100 px-1 py-0.5 rounded">/ProductTrees</code> via Service Layer
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                <span className="font-semibold">Error:</span> {modalError}
              </div>
            )}

            <form onSubmit={handleSaveBom} className="space-y-5">
              {/* Parent Product Selection */}
              {!editMode && (
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setParentMode("existing");
                        if (itemsWithoutBom.length > 0) {
                          setFormTreeCode(itemsWithoutBom[0].code);
                          setFormItemName(itemsWithoutBom[0].name);
                        }
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        parentMode === "existing"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                    >
                      Select Existing SAP Item ({itemsWithoutBom.length} without BOM)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setParentMode("new");
                        setFormTreeCode("");
                        setFormItemName("");
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        parentMode === "new"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                    >
                      + Create New SAP Item &amp; BOM
                    </button>
                  </div>

                  {parentMode === "existing" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                          Parent Item (FG / SFG in SAP OITM)
                        </label>
                        <select
                          value={formTreeCode}
                          onChange={e => {
                            const selected = availableItems.find(i => i.code === e.target.value);
                            setFormTreeCode(e.target.value);
                            setFormItemName(selected?.name || "");
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium text-gray-800"
                        >
                          <option value="">-- Select Product --</option>
                          {itemsWithoutBom.length > 0 && (
                            <optgroup label="Items Without a BOM Yet">
                              {itemsWithoutBom.map(item => (
                                <option key={item.code} value={item.code}>
                                  {item.code} — {item.name} ({item.is_intermediate ? "SFG" : "FG"})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="All FG / SFG Items">
                            {availableItems.map(item => (
                              <option key={item.code} value={item.code}>
                                {item.code} — {item.name} {item.has_bom ? "(Has BOM)" : ""}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                          Warehouse
                        </label>
                        <input
                          type="text"
                          value={formWarehouse}
                          onChange={e => setFormWarehouse(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                          placeholder="01"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                          New Item Code
                        </label>
                        <input
                          type="text"
                          value={formTreeCode}
                          onChange={e => setFormTreeCode(e.target.value)}
                          placeholder="e.g. FG0017 or SFG0009"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-mono"
                          required
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                          Item Name / Description
                        </label>
                        <input
                          type="text"
                          value={formItemName}
                          onChange={e => setFormItemName(e.target.value)}
                          placeholder="e.g. JEPE85 or Additive J"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                          Item Type
                        </label>
                        <select
                          value={formItemGroup}
                          onChange={e => setFormItemGroup(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                        >
                          <option value={102}>Finished Good (FG)</option>
                          <option value={107}>Sub-Assembly (SFG)</option>
                        </select>
                      </div>
                      {Number(formItemGroup) === 107 && (
                        <div className="sm:col-span-4 flex items-center gap-2 pt-1">
                          <input
                            id="phantom-chk"
                            type="checkbox"
                            checked={formIsPhantom}
                            onChange={e => setFormIsPhantom(e.target.checked)}
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                          />
                          <label htmlFor="phantom-chk" className="text-xs font-medium text-gray-700">
                            Mark as Phantom Sub-Assembly in SAP Item Master
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* BOM Component Lines */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800">
                    BOM Components (Total Recipe Qty: <span className="text-emerald-700">{modalTotalQty.toFixed(4)} Kg</span>)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    + Add Component Line
                  </button>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                          Type
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                          Component Item
                        </th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">
                          BOM Qty (Kg)
                        </th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">
                          Share %
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase">
                          Remove
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {formLines.map((line, idx) => {
                        const qty = parseFloat(line.quantity) || 0;
                        const pct = modalTotalQty > 0 ? (qty / modalTotalQty) * 100 : 0;

                        return (
                          <tr key={idx}>
                            <td className="px-3 py-2">
                              <select
                                value={line.compType}
                                onChange={e => handleLineChange(idx, "compType", e.target.value)}
                                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium"
                              >
                                <option value="raw">Raw Material (RM)</option>
                                <option value="sfg">Sub-Assembly (SFG)</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.itemCode}
                                onChange={e => handleLineChange(idx, "itemCode", e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium"
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
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                value={line.quantity}
                                onChange={e => handleLineChange(idx, "quantity", e.target.value)}
                                placeholder="0.0000"
                                className="w-28 border border-gray-300 rounded-lg px-2.5 py-1.5 text-right text-xs font-semibold"
                                required
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-blue-600 text-xs">
                              {pct.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-center">
                              {formLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLine(idx)}
                                  className="text-red-500 hover:text-red-700 font-bold text-xs px-2 py-1"
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
              <div className="flex items-center justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBom}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm cursor-pointer disabled:opacity-50"
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
