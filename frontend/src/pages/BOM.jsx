import { useState, useEffect, Fragment } from "react";

export default function BOM() {
  const [goods, setGoods] = useState([]);
  const [allBoms, setAllBoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Dropdown selection: "ALL", "ALL_FG", "ALL_SFG", or specific item code (e.g., "FG0016")
  const [selectedFilter, setSelectedFilter] = useState("ALL");

  // Expanded product accordions
  const [expandedAccordions, setExpandedAccordions] = useState({});

  // Expanded tree nodes (for sub-assemblies inside a formulation)
  const [expandedNodes, setExpandedNodes] = useState({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [goodsRes, bomRes] = await Promise.all([
        fetch("/api/materials/goods"),
        fetch("/api/materials/boms/all")
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

      setGoods(goodsData);
      setAllBoms(bomsData);

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

    // If a specific item is picked, auto-expand its accordion and any nested sub-assemblies
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

  const getBOMCostAndItems = (goodId, requestedQty = null, visited = new Set()) => {
    if (visited.has(goodId)) {
      return { totalCost: 0, items: [], totalRawQty: 0, unitCost: 0 };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(goodId);

    const items = allBoms.filter(b => b.finished_good_id === goodId);
    const totalRawQty = items.reduce((sum, b) => sum + parseFloat(b.quantity_required || 0), 0);

    // Top-level uses its SAP BOM quantities. Sub-assemblies scale to the parent required quantity.
    const produceQty = requestedQty !== null ? requestedQty : totalRawQty;

    let totalCost = 0;

    const renderedItems = items.map(item => {
      const rawQty = parseFloat(item.quantity_required || 0);
      const actualQty = totalRawQty > 0 ? (rawQty / totalRawQty) * produceQty : 0;

      if (item.raw_material_id) {
        const unitRate = parseFloat(item.raw_cost || 0);
        const cost = actualQty * unitRate;
        totalCost += cost;
        return {
          ...item,
          type: "raw",
          code: item.item_code || item.raw_material_id,
          name: item.raw_name,
          unitRate,
          cost,
          uom: item.raw_uom || "Kg",
          actualQty,
          rawQty
        };
      }

      if (item.child_good_id) {
        const childData = getBOMCostAndItems(item.child_good_id, actualQty, nextVisited);
        const fallbackRate = parseFloat(item.raw_cost || 0);
        const cost = childData.items.length > 0 ? childData.totalCost : actualQty * fallbackRate;
        const unitRate = actualQty > 0 ? cost / actualQty : fallbackRate;
        totalCost += cost;
        return {
          ...item,
          type: "good",
          code: item.item_code || item.child_good_id,
          name: item.child_name,
          unitRate,
          cost,
          actualQty,
          rawQty,
          childData,
          uom: item.raw_uom || "Kg"
        };
      }

      return null;
    }).filter(Boolean);

    const unitCost = produceQty > 0 ? totalCost / produceQty : 0;
    return { totalCost, items: renderedItems, totalRawQty, produceQty, unitCost };
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

            <td className="px-4 py-3 text-right font-medium text-blue-600 bg-blue-50/30">
              {bomData.totalRawQty > 0 ? ((b.rawQty / bomData.totalRawQty) * 100).toFixed(2) : "0.00"}%
            </td>

            <td className="px-4 py-3 text-right text-gray-600 text-sm">
              ₹{b.unitRate.toFixed(2)}
            </td>

            <td className="px-4 py-3 text-right font-medium text-gray-800 text-sm">
              ₹{b.cost.toFixed(2)}
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      {/* Top Header & Controls */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">SAP Bill of Materials (BOM)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Live multi-level formulations from SAP Business One via <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">D:\BHV\Config\SAPConfig.json</code>
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
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium text-gray-800 shadow-xs focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[240px]"
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

      {/* Loading / Error States */}
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

                      {/* Stats Block */}
                      <div className="flex items-center gap-6 border-l-2 pl-4 border-gray-200">
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-bold tracking-wider">Cost / Kg</div>
                          <div className="font-bold text-blue-700 text-sm sm:text-base">₹{bomData.unitCost.toFixed(2)}</div>
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-bold tracking-wider">Batch Cost</div>
                          <div className="font-bold text-gray-900 text-sm sm:text-base">₹{bomData.totalCost.toFixed(2)}</div>
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-bold tracking-wider">Batch Qty</div>
                          <div className="font-bold text-emerald-600 text-sm sm:text-base">
                            {bomData.totalRawQty.toFixed(3)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Accordion Body */}
                  {isSelected && (
                    <div className="border-t border-gray-100 bg-gray-50 p-4 sm:p-5">
                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Component (SAP Code & Description)
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                BOM Qty
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Normalized %
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Unit Rate (GRPO)
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                Est. Cost
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {bomData.items.length === 0 ? (
                              <tr>
                                <td colSpan="5" className="p-8 text-center text-gray-500 italic">
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
                                  Batch Totals:
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-emerald-700 text-base">
                                  {bomData.totalRawQty.toFixed(4)} Kg
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-blue-700">
                                  100.00%
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-gray-700 text-sm">
                                  ₹{bomData.unitCost.toFixed(2)} / Kg
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-gray-900 text-lg">
                                  ₹{bomData.totalCost.toFixed(2)}
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
    </div>
  );
}
