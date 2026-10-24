import { useState, useEffect, useRef } from "react";

const DEFAULT_WAREHOUSES = [
  { code: "01", name: "Tew Automation" },
  { code: "8", name: "Pashamylaram" },
  { code: "10", name: "Pathancheru" }
];

export default function Production() {
  const [orders, setOrders] = useState([]);
  const [goods, setGoods] = useState([]);
  const [allBoms, setAllBoms] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // MRP state
  const [mrpData, setMrpData] = useState(null);
  const [mrpFilter, setMrpFilter] = useState("ALL"); // ALL | SHORTAGE
  const [showMrpBelow, setShowMrpBelow] = useState(false);
  const mrpSectionRef = useRef(null);

  // Filters & Accordion state
  const [statusFilter, setStatusFilter] = useState("ACTIVE"); // ACTIVE | MRP | PRODUCED | ALL | P | R | L
  const [typeFilter, setTypeFilter] = useState("ALL"); // ALL | FG | SFG
  const [sortBy, setSortBy] = useState("DUE_ASC"); // DUE_ASC | DUE_DESC | DOC_ASC | DOC_DESC
  const [search, setSearch] = useState("");
  const [expandedOrders, setExpandedOrders] = useState({});
  const [busyOrderId, setBusyOrderId] = useState(null);

  const getOrderDueTime = (order) => {
    const raw = order?.due_date || order?.post_date || "";
    if (!raw) return Number.MAX_SAFE_INTEGER;
    const str = String(raw).split("T")[0];
    const t = new Date(str).getTime();
    return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  const compareOrdersByDueAsc = (a, b) => {
    const dueDiff = getOrderDueTime(a) - getOrderDueTime(b);
    if (dueDiff !== 0) return dueDiff;
    return Number(a?.doc_num || a?.doc_entry || 0) - Number(b?.doc_num || b?.doc_entry || 0);
  };

  // --- Modal 1: Plan New Production Order ---
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planItemCode, setPlanItemCode] = useState("");
  const [planQty, setPlanQty] = useState("100");
  const [planWarehouse, setPlanWarehouse] = useState("01");
  const [planDueDate, setPlanDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [planIssueMethod, setPlanIssueMethod] = useState("BOM"); // BOM | M | B
  const [planAutoRelease, setPlanAutoRelease] = useState(true);
  const [planRemarks, setPlanRemarks] = useState("");
  const [planningOrder, setPlanningOrder] = useState(false);
  const [planError, setPlanError] = useState(null);

  // --- Modal 2: Issue to Production (OIGE via Service Layer) ---
  const [issueOrder, setIssueOrder] = useState(null);
  const [issueLines, setIssueLines] = useState([]);
  const [issueComments, setIssueComments] = useState("");
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [issueError, setIssueError] = useState(null);

  // --- Modal 3: Receipt from Production / Get from Production (OIGN via Service Layer) ---
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [receiptQty, setReceiptQty] = useState("");
  const [receiptRejectedQty, setReceiptRejectedQty] = useState("0");
  const [receiptWarehouse, setReceiptWarehouse] = useState("01");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split("T")[0]);
  const [receiptShift, setReceiptShift] = useState("Day"); // Day | Night
  const [receiptAutoClose, setReceiptAutoClose] = useState(false);
  const [receiptComments, setReceiptComments] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const ts = Date.now();
      const noStore = { cache: "no-store" };
      const [ordRes, goodsRes, bomRes, rmRes, whRes, mrpRes] = await Promise.all([
        fetch(`/api/production?_t=${ts}`, noStore),
        fetch(`/api/materials/goods?_t=${ts}`, noStore),
        fetch(`/api/materials/boms/all?_t=${ts}`, noStore),
        fetch(`/api/materials?_t=${ts}`, noStore),
        fetch(`/api/materials/warehouses?_t=${ts}`, noStore),
        fetch(`/api/production/mrp?_t=${ts}`, noStore).catch(() => ({ ok: false }))
      ]);

      if (!ordRes.ok) {
        const errData = await ordRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load Production Orders from SAP");
      }

      const ordData = await ordRes.json();
      const goodsData = goodsRes.ok ? await goodsRes.json() : [];
      const bomData = bomRes.ok ? await bomRes.json() : [];
      const rmData = rmRes.ok ? await rmRes.json() : [];
      const whData = whRes.ok ? await whRes.json() : [];
      const mrpJson = mrpRes && mrpRes.ok ? await mrpRes.json().catch(() => null) : null;

      const sortedOrdData = Array.isArray(ordData)
        ? [...ordData].sort(compareOrdersByDueAsc)
        : [];
      setOrders(sortedOrdData);
      if (mrpJson && Array.isArray(mrpJson.requirements)) {
        setMrpData(mrpJson);
      }
      setGoods(goodsData);
      setAllBoms(bomData);
      setRawMaterials(rmData);
      if (Array.isArray(whData) && whData.length > 0) {
        setWarehouses(whData);
      }

      // Auto-expand first active (unproduced) order if none expanded
      const firstActive = sortedOrdData.find(
        o =>
          !o.is_produced &&
          o.status_code !== "L" &&
          o.status_code !== "C" &&
          !(Number(o.planned_qty || 0) > 0 && Number(o.completed_qty || 0) >= Number(o.planned_qty || 0) - 0.0001)
      );
      setExpandedOrders(prev =>
        Object.keys(prev).length === 0 && firstActive
          ? { [firstActive.doc_entry]: true }
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

  const toggleExpand = (docEntry) => {
    setExpandedOrders(prev => ({ ...prev, [docEntry]: !prev[docEntry] }));
  };

  const expandAll = () => {
    const next = {};
    filteredOrders.forEach(o => {
      next[o.doc_entry] = true;
    });
    setExpandedOrders(next);
  };

  const collapseAll = () => {
    setExpandedOrders({});
  };

  // Formatters
  const formatQty = (val, decimals = 2) =>
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

  const formatDate = (val) => {
    if (!val) return "—";
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).split("T")[0];
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  };

  // --- Status Change (Release / Close) ---
  const handleStatusChange = async (order, newStatusCode, label) => {
    setBusyOrderId(order.doc_entry);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/production/${order.doc_entry}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatusCode })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${label} Production Order #${order.doc_num}`);
      }
      setOrders(prev =>
        prev.map(o =>
          o.doc_entry === order.doc_entry
            ? {
                ...o,
                status_code: newStatusCode,
                status: label,
                is_produced: newStatusCode === "L" ? true : o.is_produced
              }
            : o
        )
      );
      if (newStatusCode === "L") {
        setExpandedOrders(prev => {
          const next = { ...prev };
          delete next[order.doc_entry];
          return next;
        });
      }
      setStatusMsg(
        data.message ||
          `Production Order #${order.doc_num} status updated to ${label} via SAP Service Layer`
      );
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  // --- Open Plan New Production Order Modal ---
  const openPlanModal = (defaultItemCode = "") => {
    const initialCode = defaultItemCode || (goods.length > 0 ? goods[0].code : "");
    const foundGood = goods.find(g => g.code === initialCode);
    setPlanItemCode(initialCode);
    setPlanQty("100");
    setPlanWarehouse(foundGood?.warehouse || "01");
    setPlanDueDate(new Date().toISOString().split("T")[0]);
    setPlanIssueMethod("BOM");
    setPlanAutoRelease(true);
    setPlanRemarks("");
    setPlanError(null);
    setShowPlanModal(true);
  };

  // Calculate BOM preview for the Plan Modal
  const getPlanBomPreview = () => {
    if (!planItemCode) return [];
    const lines = allBoms.filter(b => b.finished_good_id === planItemCode);
    const selectedGood = goods.find(g => g.code === planItemCode);
    const totalBomHeaderQty =
      Number(selectedGood?.batch_qty || 0) > 0
        ? Number(selectedGood.batch_qty)
        : lines.reduce((s, l) => s + Number(l.quantity_required || 0), 0) || 1;
    const targetQty = Math.max(0, Number(planQty || 0));

    // Map stock from rawMaterials or goods
    const stockLookup = {};
    rawMaterials.forEach(rm => {
      stockLookup[rm.code] = {
        total: Number(rm.on_hand ?? rm.stock_level ?? 0),
        byWh: rm.warehouse_stocks || {}
      };
    });
    goods.forEach(g => {
      if (!stockLookup[g.code]) {
        stockLookup[g.code] = {
          total: Number(g.on_hand || 0),
          byWh: {}
        };
      }
    });

    return lines.map(l => {
      const baseRatio = Number(l.quantity_required || 0) / totalBomHeaderQty;
      const reqQty = baseRatio * targetQty;
      const wh = planWarehouse || l.warehouse || "01";
      const stInfo = stockLookup[l.item_code];
      const whStock =
        stInfo?.byWh && stInfo.byWh[wh] !== undefined
          ? Number(stInfo.byWh[wh])
          : Number(stInfo?.total ?? l.on_hand ?? 0);
      return {
        itemCode: l.item_code,
        itemName: l.raw_name || l.child_name || l.item_code,
        uom: l.raw_uom || "Kg",
        issueMethod:
          planIssueMethod === "M"
            ? "M"
            : planIssueMethod === "B"
            ? "B"
            : l.issue_method || "B",
        warehouse: wh,
        baseRatio,
        requiredQty: reqQty,
        availableStock: whStock,
        isShort: whStock < reqQty
      };
    });
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    setPlanError(null);
    setStatusMsg(null);

    const numQty = parseFloat(planQty);
    if (!planItemCode) {
      setPlanError("Please select a Finished Good or Semi-Finished Good.");
      return;
    }
    if (isNaN(numQty) || numQty <= 0) {
      setPlanError("Please enter a valid Planned Quantity greater than 0.");
      return;
    }

    setPlanningOrder(true);
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: planItemCode,
          plannedQuantity: numQty,
          warehouse: planWarehouse || "01",
          dueDate: planDueDate,
          issueMethod: planIssueMethod,
          autoRelease: planAutoRelease,
          remarks: planRemarks
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create Production Order via SAP Service Layer");
      }

      setShowPlanModal(false);
      setStatusMsg(
        data.message || `Created Production Order in SAP via Service Layer`
      );
      if (data.order?.AbsoluteEntry) {
        setExpandedOrders(prev => ({ ...prev, [data.order.AbsoluteEntry]: true }));
      }
      await fetchData();
    } catch (err) {
      console.error(err);
      setPlanError(err.message);
    } finally {
      setPlanningOrder(false);
    }
  };

  // --- Open Issue to Production Modal ---
  const openIssueModal = (order) => {
    setIssueOrder(order);
    setIssueError(null);
    setIssueComments(`Issue for Production Order #${order.doc_num} (${order.item_code})`);
    const lines = (order.lines || []).map(l => {
      const remaining = Math.max(0, Number(l.planned_qty || 0) - Number(l.issued_qty || 0));
      return {
        lineNum: l.line_num,
        itemCode: l.item_code,
        itemName: l.item_name,
        uom: l.uom || "Kg",
        issueType: l.issue_type,
        plannedQty: Number(l.planned_qty || 0),
        issuedQty: Number(l.issued_qty || 0),
        whsOnHand: Number(l.whs_on_hand || 0),
        totalOnHand: Number(l.total_on_hand || 0),
        warehouse: l.warehouse || order.warehouse || "01",
        quantityToIssue: remaining > 0 ? remaining.toFixed(4) : "0"
      };
    });
    setIssueLines(lines);
  };

  const handleIssueLineChange = (idx, field, val) => {
    setIssueLines(prev =>
      prev.map((line, i) => (i === idx ? { ...line, [field]: val } : line))
    );
  };

  const handleSubmitIssue = async (e) => {
    e.preventDefault();
    if (!issueOrder) return;
    setIssueError(null);
    setStatusMsg(null);

    const payloadLines = issueLines
      .map(l => ({
        lineNum: l.lineNum,
        quantity: parseFloat(l.quantityToIssue || 0),
        warehouse: l.warehouse || "01"
      }))
      .filter(l => !isNaN(l.quantity) && l.quantity > 0);

    if (payloadLines.length === 0) {
      setIssueError("Please enter a quantity > 0 for at least one component line to issue.");
      return;
    }

    setSubmittingIssue(true);
    try {
      const res = await fetch(`/api/production/${issueOrder.doc_entry}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comments: issueComments,
          lines: payloadLines
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Issue to Production failed in SAP Service Layer");
      }

      const issuedDocEntry = issueOrder.doc_entry;
      setIssueOrder(null);
      setStatusMsg(data.message || "Issued components to Production via SAP Service Layer");
      setExpandedOrders(prev => ({ ...prev, [issuedDocEntry]: true }));
      await fetchData();
    } catch (err) {
      console.error(err);
      setIssueError(err.message);
    } finally {
      setSubmittingIssue(false);
    }
  };

  // --- Open Receipt from Production (Get from Production) Modal ---
  const openReceiptModal = (order) => {
    setReceiptOrder(order);
    setReceiptError(null);
    const remaining = Math.max(
      0,
      Number(order.planned_qty || 0) - Number(order.completed_qty || 0)
    );
    setReceiptQty(remaining > 0 ? String(remaining) : String(order.planned_qty || 1));
    setReceiptRejectedQty("0");
    setReceiptWarehouse(order.warehouse || "01");
    setReceiptDate(new Date().toISOString().split("T")[0]);
    setReceiptShift("Day");
    setReceiptAutoClose(false);
    setReceiptComments(`Receipt from Production Order #${order.doc_num} (${order.item_code})`);
  };

  const handleSubmitReceipt = async (e) => {
    e.preventDefault();
    if (!receiptOrder) return;
    setReceiptError(null);
    setStatusMsg(null);

    const qty = parseFloat(receiptQty || 0);
    const rejQty = parseFloat(receiptRejectedQty || 0);

    if ((isNaN(qty) || qty <= 0) && (isNaN(rejQty) || rejQty <= 0)) {
      setReceiptError("Please enter a valid Completed Quantity greater than 0.");
      return;
    }

    setSubmittingReceipt(true);
    try {
      const res = await fetch(`/api/production/${receiptOrder.doc_entry}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: isNaN(qty) ? 0 : qty,
          rejectedQuantity: isNaN(rejQty) ? 0 : rejQty,
          warehouse: receiptWarehouse || "01",
          docDate: receiptDate || new Date().toISOString().split("T")[0],
          shift: receiptShift || "Day",
          U_Shift: receiptShift || "Day",
          comments: receiptComments,
          autoClose: receiptAutoClose
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Receipt from Production failed in SAP Service Layer");
      }

      const recDocEntry = receiptOrder.doc_entry;
      const nowFullyReceived =
        Number(receiptOrder.planned_qty || 0) > 0 &&
        Number(receiptOrder.completed_qty || 0) + (isNaN(qty) ? 0 : qty) >=
          Number(receiptOrder.planned_qty || 0) - 0.0001;
      setReceiptOrder(null);
      setStatusMsg(data.message || "Received goods from Production via SAP Service Layer");
      setExpandedOrders(prev => ({
        ...prev,
        [recDocEntry]: !(nowFullyReceived || receiptAutoClose)
      }));
      await fetchData();
    } catch (err) {
      console.error(err);
      setReceiptError(err.message);
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const isOrderOpen = (o) => o.status_code === "P" || o.status_code === "R";

  // Filtered & Sorted Orders (Default: Due Date Earliest First)
  const filteredOrders = orders
    .filter(o => {
      if (statusFilter === "ACTIVE") {
        if (!isOrderOpen(o)) return false;
      } else if (statusFilter !== "ALL" && o.status_code !== statusFilter) {
        return false;
      }
      if (typeFilter === "FG" && o.is_intermediate === 1) return false;
      if (typeFilter === "SFG" && o.is_intermediate !== 1) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchDoc = String(o.doc_num || "").toLowerCase().includes(q);
        const matchCode = (o.item_code || "").toLowerCase().includes(q);
        const matchName = (o.item_name || "").toLowerCase().includes(q);
        if (!matchDoc && !matchCode && !matchName) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "DUE_DESC") {
        const dueDiff = getOrderDueTime(b) - getOrderDueTime(a);
        if (dueDiff !== 0) return dueDiff;
        return Number(b.doc_num || b.doc_entry || 0) - Number(a.doc_num || a.doc_entry || 0);
      }
      if (sortBy === "DOC_ASC") {
        return Number(a.doc_num || a.doc_entry || 0) - Number(b.doc_num || b.doc_entry || 0);
      }
      if (sortBy === "DOC_DESC") {
        return Number(b.doc_num || b.doc_entry || 0) - Number(a.doc_num || a.doc_entry || 0);
      }
      return compareOrdersByDueAsc(a, b);
    });

  // KPI Counts
  const totalOrdersCount = orders.length;
  const activeQueueCount = orders.filter(isOrderOpen).length;
  const plannedCount = orders.filter(o => o.status_code === "P").length;
  const releasedCount = orders.filter(o => o.status_code === "R").length;
  const closedCount = orders.filter(o => o.status_code === "L").length;

  const formatInr = (val) =>
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const orderDueByEntry = {};
  orders.forEach(o => {
    orderDueByEntry[o.doc_entry] = getOrderDueTime(o);
  });
  const sortPendingOrderRefs = (list) =>
    [...(list || [])].sort((a, b) => {
      const da = a?.due_date ? getOrderDueTime(a) : (orderDueByEntry[a?.doc_entry] ?? Number.MAX_SAFE_INTEGER);
      const dbTime = b?.due_date ? getOrderDueTime(b) : (orderDueByEntry[b?.doc_entry] ?? Number.MAX_SAFE_INTEGER);
      if (da !== dbTime) return da - dbTime;
      return Number(a?.doc_num || a?.doc_entry || 0) - Number(b?.doc_num || b?.doc_entry || 0);
    });

  // Compute live MRP from mrpData (backend /api/production/mrp) or fallback from open orders + rawMaterials
  const computedMrp = (() => {
    if (mrpData && Array.isArray(mrpData.requirements)) {
      return {
        ...mrpData,
        pendingOrders: sortPendingOrderRefs(mrpData.pendingOrders),
        requirements: mrpData.requirements.map(r => ({
          ...r,
          pending_orders: sortPendingOrderRefs(r.pending_orders)
        }))
      };
    }
    const openOrders = orders
      .filter(
        o =>
          (o.status_code === "P" || o.status_code === "R") &&
          Number(o.completed_qty || 0) < Number(o.planned_qty || 0) - 0.0001
      )
      .sort(compareOrdersByDueAsc);
    const rmMap = {};
    rawMaterials.forEach(rm => {
      rmMap[rm.code] = rm;
    });
    const goodsMap = {};
    goods.forEach(g => {
      goodsMap[g.code] = g;
    });
    const reqMap = {};
    openOrders.forEach(ord => {
      (ord.lines || []).forEach(line => {
        const pending = Math.max(0, Number(line.planned_qty || 0) - Number(line.issued_qty || 0));
        if (pending <= 0.0001) return;
        const code = line.item_code;
        if (!reqMap[code]) {
          const rm = rmMap[code];
          const gd = goodsMap[code];
          const isSfg = String(code || "").toUpperCase().startsWith("SFG") || Boolean(gd?.is_intermediate);
          const onHand = Number(rm?.on_hand ?? gd?.on_hand ?? line.total_on_hand ?? line.whs_on_hand ?? 0);
          const onOrder = Number(rm?.on_order ?? 0);
          const isCommitted = Number(rm?.is_committed ?? 0);
          const lastPur = Number(rm?.last_purchase_cost ?? rm?.unit_cost ?? gd?.last_purchase_cost ?? 0);
          const prodStd = Number(rm?.prod_std_cost ?? gd?.prod_std_cost ?? 0);
          reqMap[code] = {
            code,
            name: rm?.name || gd?.name || line.item_name || code,
            uom: rm?.uom || line.uom || "Kg",
            item_type: isSfg ? "SFG" : "RM",
            direct_required_qty: 0,
            sfg_exploded_qty: 0,
            required_qty: 0,
            on_hand: onHand,
            on_order: onOrder,
            is_committed: isCommitted,
            available_stock: onHand - isCommitted,
            last_purchase_cost: lastPur,
            prod_std_cost: prodStd,
            pending_orders: []
          };
        }
        reqMap[code].direct_required_qty += pending;
        reqMap[code].required_qty += pending;
        reqMap[code].pending_orders.push({
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

    const requirements = Object.values(reqMap)
      .map(r => {
        const toPurchaseQty = Math.max(0, r.required_qty - r.on_hand);
        const netAfterPoQty = Math.max(0, toPurchaseQty - r.on_order);
        const surplusQty = Math.max(0, r.on_hand - r.required_qty);
        const estCost = toPurchaseQty * r.last_purchase_cost;
        return {
          ...r,
          to_purchase_qty: toPurchaseQty,
          net_after_po_qty: netAfterPoQty,
          surplus_qty: surplusQty,
          estimated_purchase_cost: estCost
        };
      })
      .sort((a, b) => {
        if (b.to_purchase_qty > 0 && a.to_purchase_qty === 0) return 1;
        if (a.to_purchase_qty > 0 && b.to_purchase_qty === 0) return -1;
        if (b.to_purchase_qty !== a.to_purchase_qty) return b.to_purchase_qty - a.to_purchase_qty;
        return b.required_qty - a.required_qty;
      });

    return {
      pendingOrdersCount: openOrders.length,
      pendingOrders: openOrders,
      requirements,
      totalRequiredKg: requirements.reduce((s, r) => s + r.required_qty, 0),
      shortageItemsCount: requirements.filter(r => r.to_purchase_qty > 0.0001).length,
      totalShortageKg: requirements.reduce((s, r) => s + r.to_purchase_qty, 0),
      totalEstimatedPurchaseCost: requirements.reduce((s, r) => s + r.estimated_purchase_cost, 0)
    };
  })();

  const mrpRequirements = computedMrp.requirements || [];
  const filteredMrpRequirements = mrpRequirements.filter(r => {
    if (mrpFilter === "SHORTAGE" && Number(r.to_purchase_qty || 0) <= 0.0001) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchCode = (r.code || "").toLowerCase().includes(q);
      const matchName = (r.name || "").toLowerCase().includes(q);
      const matchOrder = (r.pending_orders || []).some(
        po =>
          String(po.doc_num || "").toLowerCase().includes(q) ||
          (po.parent_code || "").toLowerCase().includes(q) ||
          (po.parent_name || "").toLowerCase().includes(q)
      );
      if (!matchCode && !matchName && !matchOrder) return false;
    }
    return true;
  });

  const planBomPreview = showPlanModal ? getPlanBomPreview() : [];

  return (
    <div className="space-y-6 pb-20">
      {/* Top Architectural Header & KPI Card */}
      <div className="rp-card p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="sec-label mb-2">
              SAP HANA · PRODUCTION ORDERS (OWOR · WOR1 · OIGE · OIGN)
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a1a1a] tracking-[-0.02em]">
              Production <span className="italic-accent">Planning, Issue &amp; Receipt</span>
            </h1>
            <p className="text-xs sm:text-sm text-[#6b6863] mt-1.5 max-w-3xl">
              End-to-end SAP Business One shop-floor execution: create &amp; release{" "}
              <span className="font-semibold text-[#1a1a1a]">Production Orders (OWOR)</span>, issue
              raw materials via{" "}
              <span className="font-semibold text-[#c8102e]">Issue for Production (OIGE)</span>, and
              receive finished goods into stock via{" "}
              <span className="font-semibold text-[#006D77]">Receipt from Production (OIGN)</span>{" "}
              strictly through the SAP Service Layer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button onClick={() => openPlanModal()} className="rp-btn rp-btn-red">
              + Plan Production Order
            </button>
            <button onClick={fetchData} className="rp-btn rp-btn-dark">
              Refresh SAP Data
            </button>
          </div>
        </div>

        {/* 4-Cell KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6 pt-6 border-t border-black/[0.08]">
          <div className="bg-[#faf9f7] border border-black/[0.08] rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
              Total Production Orders
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#1a1a1a] mt-1">
              {totalOrdersCount}
            </div>
            <div className="text-[11px] text-[#8a8780] mt-0.5">
              All FG &amp; SFG orders in SAP OWOR
            </div>
          </div>

          <div className="bg-amber-500/[0.05] border border-amber-500/25 rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-amber-800">
              Planned (Status: P)
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-amber-700 mt-1">
              {plannedCount}
            </div>
            <div className="text-[11px] text-amber-900/70 mt-0.5">
              Awaiting shop-floor release
            </div>
          </div>

          <div className="bg-[#006D77]/[0.05] border border-[#006D77]/25 rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#006D77]">
              Released / Active (Status: R)
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#006D77] mt-1">
              {releasedCount}
            </div>
            <div className="text-[11px] text-[#6b6863] mt-0.5">
              Ready for Material Issue &amp; Receipt
            </div>
          </div>

          <div className="bg-emerald-950/[0.04] border border-emerald-600/25 rounded-[4px] p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-emerald-800">
              Closed / Completed (Status: L)
            </div>
            <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-emerald-700 mt-1">
              {closedCount}
            </div>
            <div className="text-[11px] text-emerald-800/75 mt-0.5">
              Completed &amp; finalized in SAP
            </div>
          </div>
        </div>

        {/* View Mode Queue Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-black/[0.06]">
          <button
            type="button"
            onClick={() => setStatusFilter("ACTIVE")}
            className={`px-4 py-2 rounded-[4px] text-xs font-extrabold uppercase tracking-[0.08em] transition-all cursor-pointer border ${
              statusFilter === "ACTIVE"
                ? "bg-[#1a1a1a] text-white border-[#1a1a1a] shadow-sm"
                : "bg-[#faf9f7] text-[#444444] border-black/[0.12] hover:bg-[#f4f2ef]"
            }`}
          >
            Open / Active Orders ({activeQueueCount})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("L")}
            className={`px-4 py-2 rounded-[4px] text-xs font-extrabold uppercase tracking-[0.08em] transition-all cursor-pointer border ${
              statusFilter === "L"
                ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                : "bg-[#faf9f7] text-emerald-800 border-emerald-600/25 hover:bg-emerald-950/[0.05]"
            }`}
          >
            ✓ Closed History (L) ({closedCount})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`px-4 py-2 rounded-[4px] text-xs font-extrabold uppercase tracking-[0.08em] transition-all cursor-pointer border ${
              statusFilter === "ALL"
                ? "bg-[#006D77] text-white border-[#006D77] shadow-sm"
                : "bg-[#faf9f7] text-[#444444] border-black/[0.12] hover:bg-[#f4f2ef]"
            }`}
          >
            All Orders ({totalOrdersCount})
          </button>

        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3 mt-3 pt-3 border-t border-black/[0.05]">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search Order #, Item Code or Product..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-black/[0.15] rounded-[4px] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#1a1a1a] font-medium focus:border-[#c8102e] focus:outline-none min-w-[240px]"
            />

            <div className="flex items-center gap-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6b6863]">
                SAP Status:
              </label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="border border-black/[0.15] rounded-[4px] px-3 py-2 text-xs font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
              >
                <option value="ACTIVE">Open Orders (P &amp; R) ({activeQueueCount})</option>
                <option value="ALL">All Statuses ({totalOrdersCount})</option>
                <option value="P">Planned (P) ({plannedCount})</option>
                <option value="R">Released (R) ({releasedCount})</option>
                <option value="L">Closed (L) ({closedCount})</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6b6863]">
                Product Type:
              </label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="border border-black/[0.15] rounded-[4px] px-3 py-2 text-xs font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
              >
                <option value="ALL">All (FG &amp; SFG)</option>
                <option value="FG">Finished Goods (FG)</option>
                <option value="SFG">Semi-Finished Goods (SFG)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6b6863]">
                Sort Plan:
              </label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="border border-black/[0.15] rounded-[4px] px-3 py-2 text-xs font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
              >
                <option value="DUE_ASC">Due Date (Earliest First)</option>
                <option value="DUE_DESC">Due Date (Latest First)</option>
                <option value="DOC_ASC">Order # (Oldest First)</option>
                <option value="DOC_DESC">Order # (Newest First)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="rp-btn rp-btn-outline py-1.5 px-3 text-[10px]">
              Expand All
            </button>
            <button onClick={collapseAll} className="rp-btn rp-btn-outline py-1.5 px-3 text-[10px]">
              Collapse All
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

      {/* Production Orders List */}
      {loading ? (
        <div className="rp-card p-14 text-center">
          <div className="inline-block w-6 h-6 border-2 border-[#c8102e] border-t-transparent rounded-full animate-spin mb-3" />
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#6b6863]">
            Loading Production Orders, Component Lines &amp; SAP Transactions...
          </div>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rp-card p-12 text-center text-[#6b6863]">
          <div className="text-sm font-semibold text-[#1a1a1a] mb-1">
            No SAP Production Orders match your current filter.
          </div>
          <div className="text-xs text-[#8a8780] mb-4">
            Click &ldquo;+ Plan Production Order&rdquo; to create a new Production Order in SAP Business One.
          </div>
          <button onClick={() => openPlanModal()} className="rp-btn rp-btn-red">
            + Plan First Production Order
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map(order => {
            const isExpanded = !!expandedOrders[order.doc_entry];
            const isSfg = order.is_intermediate === 1;
            const planned = Number(order.planned_qty || 0);
            const completed = Number(order.completed_qty || 0);
            const rejected = Number(order.rejected_qty || 0);
            const remaining = Math.max(0, planned - completed);
            const pct = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;
            const isBusy = busyOrderId === order.doc_entry;
            const allComponentsIssued =
              Boolean(order.is_fully_issued) ||
              ((order.lines || []).length > 0 &&
                order.lines.every(
                  l => Number(l.issued_qty || 0) >= Number(l.planned_qty || 0) - 0.0001
                ));
            const fullyReceived =
              Boolean(order.is_fully_received) ||
              (planned > 0 && completed >= planned - 0.0001);

            const statusBadgeClass =
              order.status_code === "R"
                ? "bg-[#006D77]/10 text-[#006D77] border-[#006D77]/30"
                : order.status_code === "L"
                ? "bg-emerald-950/[0.08] text-emerald-800 border-emerald-600/30"
                : order.status_code === "C"
                ? "bg-[#c8102e]/10 text-[#c8102e] border-[#c8102e]/30"
                : "bg-amber-500/10 text-amber-800 border-amber-500/30";

            return (
              <div
                key={order.doc_entry}
                className="rp-card overflow-hidden transition-all"
                style={{
                  borderLeft: `4px solid ${isSfg ? "#006D77" : "#c8102e"}`
                }}
              >
                {/* Order Header Bar */}
                <div
                  onClick={() => toggleExpand(order.doc_entry)}
                  className="p-5 sm:p-6 bg-white hover:bg-[#faf9f7] transition-colors cursor-pointer flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                >
                  {/* Left Info */}
                  <div className="flex items-start gap-3.5">
                    <span className="mt-1 inline-flex items-center justify-center w-6 h-6 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] text-xs font-bold border border-black/[0.08] shrink-0">
                      {isExpanded ? "▾" : "▸"}
                    </span>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-mono-code text-xs font-extrabold px-2.5 py-0.5 rounded-[3px] bg-[#1a1a1a] text-white">
                          ORDER #{order.doc_num}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-[0.09em] px-2.5 py-0.5 rounded-[3px] border ${statusBadgeClass}`}
                        >
                          {order.status} ({order.status_code})
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-[3px] ${
                            isSfg
                              ? "bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/20"
                              : "bg-[#c8102e]/10 text-[#c8102e] border border-[#c8102e]/20"
                          }`}
                        >
                          {isSfg ? "SFG · Sub-Assembly" : "FG · Finished Good"}
                        </span>
                        <span className="font-mono-code text-xs font-bold px-2 py-0.5 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08]">
                          {order.item_code}
                        </span>
                        <span className="font-mono-code text-[11px] text-[#6b6863] bg-[#faf9f7] px-2 py-0.5 rounded-[3px] border border-black/[0.08]">
                          WH: {order.warehouse || "01"}
                        </span>
                      </div>

                      <h3 className="text-base sm:text-lg font-extrabold text-[#1a1a1a]">
                        {order.item_name}
                      </h3>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-[#6b6863] mt-1">
                        <span>
                          Posting Date:{" "}
                          <strong className="font-mono-code text-[#1a1a1a]">
                            {formatDate(order.post_date)}
                          </strong>
                        </span>
                        <span>
                          Due Date:{" "}
                          <strong className="font-mono-code text-[#1a1a1a]">
                            {formatDate(order.due_date)}
                          </strong>
                        </span>
                        <span>
                          Components:{" "}
                          <strong className="font-mono-code text-[#1a1a1a]">
                            {(order.lines || []).length} line(s)
                          </strong>
                        </span>
                        {order.comments && (
                          <span className="italic text-[#8a8780] truncate max-w-md">
                            &ldquo;{order.comments}&rdquo;
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Metrics & Action Buttons */}
                  <div
                    className="flex flex-wrap items-center justify-between xl:justify-end gap-4 pt-3 xl:pt-0 border-t xl:border-t-0 border-black/[0.06]"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Quantities Box */}
                    <div className="flex items-center gap-4 bg-[#faf9f7] px-4 py-2.5 rounded-[4px] border border-black/[0.08]">
                      <div className="text-right">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#6b6863]">
                          Planned Qty
                        </div>
                        <div className="font-mono-code font-extrabold text-sm text-[#1a1a1a]">
                          {formatQty(planned)} {order.uom || "Kg"}
                        </div>
                      </div>

                      <div className="h-7 w-[1px] bg-black/[0.08]" />

                      <div className="text-right">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-emerald-800">
                          Received (FG)
                        </div>
                        <div className="font-mono-code font-extrabold text-sm text-emerald-700">
                          {formatQty(completed)} {order.uom || "Kg"}{" "}
                          <span className="text-[10px] font-semibold text-[#6b6863]">
                            ({pct}%)
                          </span>
                        </div>
                      </div>

                      <div className="h-7 w-[1px] bg-black/[0.08]" />

                      <div className="text-right">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#c8102e]">
                          Pending Qty
                        </div>
                        <div className="font-mono-code font-extrabold text-sm text-[#c8102e]">
                          {formatQty(remaining)} {order.uom || "Kg"}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {order.status_code === "P" && !fullyReceived && (
                        <button
                          onClick={() => handleStatusChange(order, "R", "Released")}
                          disabled={isBusy}
                          className="rp-btn rp-btn-dark py-2 px-3 text-[10.5px]"
                          title="Release Order in SAP (boposReleased)"
                        >
                          {isBusy ? "Updating..." : "1. Release Order"}
                        </button>
                      )}

                      {(order.status_code === "P" || order.status_code === "R") && (
                        <>
                          {allComponentsIssued ? (
                            <span
                              className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] px-2.5 py-1.5 rounded-[4px] bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/30"
                              title="All planned BOM components have been issued to production"
                            >
                              ✓ Materials Issued
                            </span>
                          ) : (
                            !fullyReceived && (
                              <button
                                onClick={() => openIssueModal(order)}
                                disabled={isBusy}
                                className="rp-btn rp-btn-outline py-2 px-3 text-[10.5px] border-[#c8102e]/40 text-[#c8102e] hover:bg-[#c8102e]/[0.05]"
                                title="Issue Raw Materials to Production (SAP OIGE)"
                              >
                                Issue to Production
                              </button>
                            )
                          )}

                          {fullyReceived ? (
                            <span
                              className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] px-3 py-1.5 rounded-[4px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30"
                              title="Full planned quantity has already been received into stock — ready for you to close"
                            >
                              ✓ 100% Produced ({formatQty(completed)} {order.uom || "Kg"})
                            </span>
                          ) : (
                            <button
                              onClick={() => openReceiptModal(order)}
                              disabled={isBusy}
                              className="rp-btn rp-btn-red py-2 px-3 text-[10.5px]"
                              title="Receive Finished Goods from Production (SAP OIGN)"
                            >
                              Get from Production (Receipt)
                            </button>
                          )}
                        </>
                      )}

                      {order.status_code === "L" && (
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] px-3 py-1.5 rounded-[4px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30">
                          ✓ Produced &amp; Closed ({formatQty(completed)} {order.uom || "Kg"})
                        </span>
                      )}

                      {order.status_code === "R" && (
                        <button
                          onClick={() => handleStatusChange(order, "L", "Closed")}
                          disabled={isBusy}
                          className={
                            fullyReceived
                              ? "rp-btn rp-btn-red py-2 px-3.5 text-[10.5px]"
                              : "rp-btn rp-btn-outline py-2 px-3 text-[10.5px]"
                          }
                          title="Close Production Order in SAP (boposClosed)"
                        >
                          {isBusy
                            ? "Closing..."
                            : fullyReceived
                            ? "Close Order in SAP"
                            : "Close Order"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Order Details */}
                {isExpanded && (
                  <div className="border-t border-black/[0.08] bg-[#faf9f7] p-5 sm:p-6 space-y-6">
                    {/* Section 1: Component Lines (WOR1) */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                        <div>
                          <h4 className="text-xs font-extrabold uppercase tracking-[0.11em] text-[#1a1a1a]">
                            Production Order Components (SAP WOR1) &amp; Live Warehouse Stock
                          </h4>
                          <p className="text-[11px] text-[#6b6863]">
                            Shows required quantities, issued quantities, issue method (Manual vs
                            Backflush), and live stock in the component warehouse.
                          </p>
                        </div>

                        {(order.status_code === "P" || order.status_code === "R") && (
                          <div className="flex flex-wrap items-center gap-2">
                            {allComponentsIssued ? (
                              <>
                                <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] px-2.5 py-1 rounded-[3px] bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/30">
                                  ✓ All Components Issued
                                </span>
                                {!fullyReceived && (
                                  <button
                                    onClick={() => openIssueModal(order)}
                                    className="text-[10.5px] font-semibold text-[#6b6863] hover:text-[#1a1a1a] underline cursor-pointer px-1.5"
                                  >
                                    Issue Extra RM
                                  </button>
                                )}
                              </>
                            ) : (
                              !fullyReceived && (
                                <button
                                  onClick={() => openIssueModal(order)}
                                  className="rp-btn rp-btn-outline py-1.5 px-3 text-[10px]"
                                >
                                  + Issue Components Now (OIGE)
                                </button>
                              )
                            )}

                            {fullyReceived ? (
                              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] px-2.5 py-1 rounded-[3px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30">
                                ✓ Produced ({formatQty(completed)} {order.uom || "Kg"})
                              </span>
                            ) : (
                              <button
                                onClick={() => openReceiptModal(order)}
                                className="rp-btn rp-btn-red py-1.5 px-3 text-[10px]"
                              >
                                + Receive {order.item_code} Now (OIGN)
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="bg-white rounded-[4px] border border-black/[0.08] overflow-x-auto">
                        <table className="min-w-full divide-y divide-black/[0.08]">
                          <thead className="bg-[#f4f2ef]">
                            <tr>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.09em]">
                                Line #
                              </th>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.09em]">
                                Component Code &amp; Name
                              </th>
                              <th className="px-4 py-2.5 text-center text-[10px] font-bold text-[#444444] uppercase tracking-[0.09em]">
                                Issue Method
                              </th>
                              <th className="px-4 py-2.5 text-center text-[10px] font-bold text-[#444444] uppercase tracking-[0.09em]">
                                WH
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.09em]">
                                Base Ratio
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold text-[#1a1a1a] uppercase tracking-[0.09em]">
                                Planned Qty
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold text-[#006D77] uppercase tracking-[0.09em] bg-[#006D77]/[0.04]">
                                Issued Qty
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.09em]">
                                Pending Issue
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold text-emerald-800 uppercase tracking-[0.09em] bg-emerald-950/[0.04]">
                                Live WH Stock (OITW)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/[0.06] text-xs">
                            {(order.lines || []).length === 0 ? (
                              <tr>
                                <td colSpan="9" className="p-4 text-center text-[#6b6863] italic">
                                  No component lines found in WOR1 for this Production Order.
                                </td>
                              </tr>
                            ) : (
                              order.lines.map(line => {
                                const linePlanned = Number(line.planned_qty || 0);
                                const lineIssued = Number(line.issued_qty || 0);
                                const linePending = Math.max(0, linePlanned - lineIssued);
                                const whStock = Number(line.whs_on_hand || 0);
                                const stockEnough = whStock >= linePending || linePending <= 0.0001;
                                const isManual = line.issue_type === "M";

                                return (
                                  <tr key={line.line_num} className="hover:bg-[#faf9f7]">
                                    <td className="px-4 py-2.5 font-mono-code text-[#6b6863]">
                                      #{line.line_num + 1}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono-code font-bold text-[11px] px-2 py-0.5 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08]">
                                          {line.item_code}
                                        </span>
                                        <span className="font-semibold text-[#1a1a1a]">
                                          {line.item_name}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span
                                        className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-[3px] border ${
                                          isManual
                                            ? "bg-amber-500/10 text-amber-800 border-amber-500/30"
                                            : "bg-[#006D77]/10 text-[#006D77] border-[#006D77]/30"
                                        }`}
                                      >
                                        {isManual ? "Manual (M)" : "Backflush (B)"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-center font-mono-code font-semibold text-[#444444]">
                                      {line.warehouse || "01"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono-code text-[#6b6863]">
                                      {Number(line.base_qty || 0).toFixed(4)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono-code font-bold text-[#1a1a1a]">
                                      {formatQty(linePlanned, 3)} {line.uom || "Kg"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono-code font-bold text-[#006D77] bg-[#006D77]/[0.02]">
                                      {formatQty(lineIssued, 3)} {line.uom || "Kg"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono-code font-bold text-[#c8102e]">
                                      {formatQty(linePending, 3)} {line.uom || "Kg"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono-code bg-emerald-950/[0.015]">
                                      <div className="inline-flex items-center gap-1.5">
                                        <span
                                          className={`font-bold ${
                                            stockEnough ? "text-emerald-700" : "text-[#c8102e]"
                                          }`}
                                        >
                                          {formatQty(whStock, 2)} {line.uom || "Kg"}
                                        </span>
                                        {order.status_code !== "L" && (
                                          <span
                                            className={`text-[9.5px] font-bold uppercase px-1.5 py-0.2 rounded-[2px] ${
                                              stockEnough
                                                ? "bg-emerald-950/[0.08] text-emerald-800"
                                                : "bg-[#c8102e]/10 text-[#c8102e]"
                                            }`}
                                          >
                                            {stockEnough ? "OK" : "SHORT"}
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

                    {/* Section 2: SAP Transaction History (Issues OIGE & Receipts OIGN) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Issues to Production (OIGE) */}
                      <div className="bg-white rounded-[4px] border border-black/[0.08] p-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <h5 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#c8102e]">
                            SAP Issues for Production (OIGE / IGE1)
                          </h5>
                          <span className="font-mono-code text-[11px] font-bold text-[#6b6863]">
                            {(order.issues || []).length} record(s)
                          </span>
                        </div>

                        {(order.issues || []).length === 0 ? (
                          <div className="text-xs text-[#8a8780] italic py-3">
                            No component issues recorded yet (or components will be backflushed on
                            receipt).
                          </div>
                        ) : (
                          <div className="overflow-x-auto max-h-48 overflow-y-auto">
                            <table className="min-w-full divide-y divide-black/[0.06] text-xs">
                              <thead className="bg-[#f4f2ef]">
                                <tr>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Issue Doc #
                                  </th>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Date
                                  </th>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Component
                                  </th>
                                  <th className="px-3 py-1.5 text-right text-[9.5px] font-bold uppercase text-[#444444]">
                                    Issued Qty
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/[0.05]">
                                {order.issues.map((iss, idx) => (
                                  <tr key={`${iss.doc_entry}_${idx}`}>
                                    <td className="px-3 py-1.5 font-mono-code font-bold text-[#1a1a1a]">
                                      #{iss.doc_num}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono-code text-[#6b6863]">
                                      {formatDate(iss.doc_date)}
                                    </td>
                                    <td className="px-3 py-1.5 font-semibold text-[#1a1a1a]">
                                      {iss.item_code}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono-code font-bold text-[#c8102e]">
                                      -{formatQty(iss.quantity, 3)} Kg (WH {iss.warehouse})
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Receipts from Production (OIGN) */}
                      <div className="bg-white rounded-[4px] border border-black/[0.08] p-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <h5 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-emerald-800">
                            SAP Receipts from Production (OIGN / IGN1)
                          </h5>
                          <span className="font-mono-code text-[11px] font-bold text-[#6b6863]">
                            {(order.receipts || []).length} record(s)
                          </span>
                        </div>

                        {(order.receipts || []).length === 0 ? (
                          <div className="text-xs text-[#8a8780] italic py-3">
                            No finished goods received from this production order yet.
                          </div>
                        ) : (
                          <div className="overflow-x-auto max-h-48 overflow-y-auto">
                            <table className="min-w-full divide-y divide-black/[0.06] text-xs">
                              <thead className="bg-[#f4f2ef]">
                                <tr>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Receipt Doc #
                                  </th>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Date
                                  </th>
                                  <th className="px-3 py-1.5 text-center text-[9.5px] font-bold uppercase text-[#444444]">
                                    Shift (U_Shift)
                                  </th>
                                  <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase text-[#444444]">
                                    Product
                                  </th>
                                  <th className="px-3 py-1.5 text-right text-[9.5px] font-bold uppercase text-[#444444]">
                                    Received Qty
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/[0.05]">
                                {order.receipts.map((rec, idx) => {
                                  const rawShift =
                                    rec.shift ||
                                    rec.U_Shift ||
                                    (rec.comments && String(rec.comments).match(/\[Shift:\s*([^\]]+)\]/i)?.[1]) ||
                                    "";
                                  const normShift =
                                    String(rawShift).trim().toUpperCase().startsWith("N")
                                      ? "Night"
                                      : String(rawShift).trim().toUpperCase().startsWith("D")
                                      ? "Day"
                                      : String(rawShift).trim();
                                  return (
                                    <tr key={`${rec.doc_entry}_${idx}`}>
                                      <td className="px-3 py-1.5 font-mono-code font-bold text-[#1a1a1a]">
                                        #{rec.doc_num}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono-code text-[#6b6863]">
                                        {formatDate(rec.doc_date)}
                                      </td>
                                      <td className="px-3 py-1.5 text-center">
                                        {normShift ? (
                                          <span
                                            className={`font-mono-code text-[10px] font-bold uppercase px-2 py-0.5 rounded-[3px] border ${
                                              normShift === "Night"
                                                ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                                                : "bg-amber-500/10 text-amber-800 border-amber-500/30"
                                            }`}
                                          >
                                            {normShift}
                                          </span>
                                        ) : (
                                          <span className="text-[#8a8780]">—</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 font-semibold text-[#1a1a1a]">
                                        {rec.item_code}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono-code font-bold text-emerald-700">
                                        +{formatQty(rec.quantity, 2)} Kg (WH {rec.warehouse})
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          BOTTOM MRP BUTTON & MATERIAL REQUIREMENTS / PURCHASE PLAN SECTION
      ===================================================================== */}
      {!loading && (
        <div ref={mrpSectionRef} className="pt-2 space-y-5">
          <div
            className="rp-card p-5 sm:p-6 bg-white"
            style={{
              borderLeft: `4px solid ${
                computedMrp.shortageItemsCount > 0 ? "#c8102e" : "#006D77"
              }`
            }}
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] px-2.5 py-0.5 rounded-[3px] bg-[#1a1a1a] text-white">
                    MATERIAL REQUIREMENTS &amp; PURCHASE PLAN (MRP)
                  </span>
                  <span className="font-mono-code text-xs font-bold px-2.5 py-0.5 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.08]">
                    {computedMrp.pendingOrdersCount} Pending Order(s)
                  </span>
                  <span className="font-mono-code text-xs font-bold px-2.5 py-0.5 rounded-[3px] bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/25">
                    {mrpRequirements.length} Material(s) Required ({formatQty(computedMrp.totalRequiredKg)} Kg)
                  </span>
                  {computedMrp.shortageItemsCount > 0 ? (
                    <span className="font-mono-code text-xs font-extrabold px-2.5 py-0.5 rounded-[3px] bg-[#c8102e]/10 text-[#c8102e] border border-[#c8102e]/30">
                      {computedMrp.shortageItemsCount} Short · Buy {formatQty(computedMrp.totalShortageKg)} Kg
                    </span>
                  ) : (
                    <span className="font-mono-code text-xs font-bold px-2.5 py-0.5 rounded-[3px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30">
                      ✓ All Materials in Stock
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6b6863]">
                  Calculate total raw material &amp; SFG requirements across all open Production Orders, compare against live SAP stock, and view exact quantities to purchase.
                </p>
              </div>

              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = !showMrpBelow;
                    setShowMrpBelow(next);
                    if (next) {
                      setTimeout(
                        () =>
                          mrpSectionRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                          }),
                        100
                      );
                    }
                  }}
                  className={`rp-btn ${showMrpBelow ? "rp-btn-dark" : "rp-btn-red"} py-2.5 px-5 text-xs`}
                >
                  {showMrpBelow
                    ? "Hide Material Requirements (MRP) ▲"
                    : "Get Material Requirements & Purchase Plan (MRP) ▼"}
                </button>
              </div>
            </div>
          </div>

          {showMrpBelow && (
        <div className="space-y-5">
          {/* MRP Dedicated KPI Strip & Controls Card */}
          <div className="rp-card p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-black/[0.08]">
              <div>
                <div className="sec-label mb-1">
                  MATERIAL REQUIREMENTS PLANNING (MRP) · OPEN PRODUCTION ORDERS (OWOR &amp; WOR1)
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#1a1a1a]">
                  Pending Production Material Requirements &amp;{" "}
                  <span className="italic-accent">To-Purchase Shortage Plan</span>
                </h2>
                <p className="text-xs text-[#6b6863] mt-1">
                  Aggregates unissued component quantities across all open Production Orders (Status{" "}
                  <code className="font-mono-code font-bold text-[#1a1a1a]">P</code> &amp;{" "}
                  <code className="font-mono-code font-bold text-[#1a1a1a]">R</code>), compares
                  against live SAP <code className="font-mono-code font-bold text-[#1a1a1a]">OITM.OnHand</code>{" "}
                  stock, and calculates exact purchase shortages.
                </p>
              </div>

              {/* Filter Toggle: All Required vs Shortages Only */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setMrpFilter("ALL")}
                  className={`px-3.5 py-2 rounded-[4px] text-xs font-extrabold uppercase tracking-[0.07em] border cursor-pointer transition-all ${
                    mrpFilter === "ALL"
                      ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                      : "bg-[#faf9f7] text-[#444444] border-black/[0.12] hover:bg-[#f4f2ef]"
                  }`}
                >
                  All Required Materials ({mrpRequirements.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMrpFilter("SHORTAGE")}
                  className={`px-3.5 py-2 rounded-[4px] text-xs font-extrabold uppercase tracking-[0.07em] border cursor-pointer transition-all ${
                    mrpFilter === "SHORTAGE"
                      ? "bg-[#c8102e] text-white border-[#c8102e]"
                      : "bg-[#c8102e]/[0.06] text-[#c8102e] border-[#c8102e]/30 hover:bg-[#c8102e]/[0.12]"
                  }`}
                >
                  Shortages / To Be Purchased Only ({computedMrp.shortageItemsCount})
                </button>
              </div>
            </div>

            {/* 4-Card MRP KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-5">
              <div className="bg-[#faf9f7] border border-black/[0.08] rounded-[4px] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#6b6863]">
                  Pending Production Orders
                </div>
                <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#1a1a1a] mt-1">
                  {computedMrp.pendingOrdersCount}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(computedMrp.pendingOrders || []).map(po => (
                    <span
                      key={po.doc_entry}
                      className="font-mono-code text-[10px] font-bold px-1.5 py-0.2 rounded-[2px] bg-[#1a1a1a] text-white"
                    >
                      Ord #{po.doc_num} ({po.item_code})
                    </span>
                  ))}
                </div>
              </div>

              <div className="bg-[#006D77]/[0.05] border border-[#006D77]/25 rounded-[4px] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#006D77]">
                  Total Materials Required
                </div>
                <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#006D77] mt-1">
                  {formatQty(computedMrp.totalRequiredKg)}{" "}
                  <span className="text-xs font-bold">Kg</span>
                </div>
                <div className="text-[11px] text-[#6b6863] mt-0.5">
                  Across {mrpRequirements.length} unique component(s)
                </div>
              </div>

              <div className="bg-[#c8102e]/[0.05] border border-[#c8102e]/30 rounded-[4px] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#c8102e]">
                  Materials in Shortage (To Purchase)
                </div>
                <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-[#c8102e] mt-1">
                  {computedMrp.shortageItemsCount} Item(s) ·{" "}
                  {formatQty(computedMrp.totalShortageKg)}{" "}
                  <span className="text-xs font-bold">Kg</span>
                </div>
                <div className="text-[11px] text-[#c8102e]/80 mt-0.5">
                  Where Required Qty &gt; SAP Stock On Hand
                </div>
              </div>

              <div className="bg-amber-500/[0.06] border border-amber-500/30 rounded-[4px] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-amber-900">
                  Est. Purchase Value (Shortage)
                </div>
                <div className="text-xl sm:text-2xl font-extrabold font-mono-code text-amber-800 mt-1">
                  ₹{formatInr(computedMrp.totalEstimatedPurchaseCost)}
                </div>
                <div className="text-[11px] text-amber-900/75 mt-0.5">
                  Valued at SAP Last Purchase Price
                </div>
              </div>
            </div>
          </div>

          {/* Detailed MRP Table */}
          <div className="rp-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-black/[0.08]">
                <thead className="bg-[#f4f2ef]">
                  <tr>
                    <th className="px-4 py-3.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                      SAP Code &amp; Material Description
                    </th>
                    <th className="px-4 py-3.5 text-left text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                      Pending Orders Breakdown
                    </th>
                    <th className="px-4 py-3.5 text-right text-[10px] font-bold text-[#1a1a1a] uppercase tracking-[0.1em] bg-black/[0.02]">
                      Total Qty Required
                    </th>
                    <th className="px-4 py-3.5 text-right text-[10px] font-bold text-emerald-800 uppercase tracking-[0.1em] bg-emerald-950/[0.04]">
                      Available Stock (On Hand)
                    </th>
                    <th className="px-4 py-3.5 text-right text-[10px] font-bold text-[#006D77] uppercase tracking-[0.1em]">
                      Open PO (On Order)
                    </th>
                    <th className="px-4 py-3.5 text-right text-[10px] font-bold text-[#c8102e] uppercase tracking-[0.1em] bg-[#c8102e]/[0.05]">
                      Shortage / Qty To Purchase
                    </th>
                    <th className="px-4 py-3.5 text-right text-[10px] font-bold text-[#444444] uppercase tracking-[0.1em]">
                      Last Pur. Rate &amp; Est. Purchase Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black/[0.06] text-xs">
                  {filteredMrpRequirements.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-10 text-center text-[#6b6863] italic text-sm">
                        {mrpFilter === "SHORTAGE"
                          ? "No material shortages found — all required materials are sufficiently covered by current SAP stock!"
                          : "No pending material requirements found across open Production Orders."}
                      </td>
                    </tr>
                  ) : (
                    filteredMrpRequirements.map(item => {
                      const reqQty = Number(item.required_qty || 0);
                      const onHand = Number(item.on_hand || 0);
                      const onOrder = Number(item.on_order || 0);
                      const toBuy = Number(item.to_purchase_qty || 0);
                      const surplus = Number(item.surplus_qty || 0);
                      const netAfterPo = Number(item.net_after_po_qty || 0);
                      const lastPur = Number(item.last_purchase_cost || 0);
                      const estCost = Number(item.estimated_purchase_cost || 0);
                      const isShort = toBuy > 0.0001;

                      return (
                        <tr
                          key={item.code}
                          className={`hover:bg-[#faf9f7] transition-colors ${
                            isShort ? "bg-[#c8102e]/[0.02]" : ""
                          }`}
                        >
                          {/* 1. SAP Code & Material Description */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-mono-code text-xs font-extrabold px-2.5 py-1 rounded-[3px] bg-[#f4f2ef] text-[#1a1a1a] border border-black/[0.1]">
                                {item.code}
                              </span>
                              <span
                                className={`text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-[2px] ${
                                  item.item_type === "SFG"
                                    ? "bg-[#006D77]/10 text-[#006D77]"
                                    : "bg-black/[0.06] text-[#444444]"
                                }`}
                              >
                                {item.item_type || "RM"}
                              </span>
                            </div>
                            <div className="font-bold text-sm text-[#1a1a1a] mt-1">
                              {item.name}
                            </div>
                          </td>

                          {/* 2. Pending Orders Breakdown */}
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1.5">
                              {(item.pending_orders || []).map((po, idx) => (
                                <span
                                  key={`${po.doc_entry}_${idx}`}
                                  className="font-mono-code text-[11px] font-semibold px-2 py-1 rounded-[3px] bg-[#faf9f7] text-[#1a1a1a] border border-black/[0.1]"
                                  title={`Order #${po.doc_num} — ${po.parent_name} (WH ${po.warehouse || "01"})`}
                                >
                                  Order #{po.doc_num} ({po.parent_code}):{" "}
                                  <strong className="text-[#c8102e]">
                                    {formatQty(po.pending_qty)} {item.uom || "Kg"}
                                  </strong>
                                  {po.via_sfg && (
                                    <span className="text-[#006D77] ml-1">
                                      [via {po.via_sfg}]
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* 3. Total Qty Required */}
                          <td className="px-4 py-3.5 text-right font-mono-code font-extrabold text-sm text-[#1a1a1a] bg-black/[0.015] whitespace-nowrap">
                            {formatQty(reqQty)} {item.uom || "Kg"}
                            {Number(item.sfg_exploded_qty || 0) > 0.0001 && (
                              <div className="text-[10px] font-normal text-[#006D77]">
                                Incl. {formatQty(item.sfg_exploded_qty)} Kg via SFG BOM
                              </div>
                            )}
                          </td>

                          {/* 4. Available Stock (On Hand) */}
                          <td className="px-4 py-3.5 text-right font-mono-code bg-emerald-950/[0.015] whitespace-nowrap">
                            <span
                              className={`font-bold text-sm px-2.5 py-0.5 rounded-[3px] border ${
                                !isShort
                                  ? "bg-emerald-950/[0.06] text-emerald-800 border-emerald-600/25"
                                  : onHand > 0
                                  ? "bg-amber-500/10 text-amber-800 border-amber-500/30"
                                  : "bg-[#c8102e]/10 text-[#c8102e] border-[#c8102e]/25"
                              }`}
                            >
                              {formatQty(onHand)} {item.uom || "Kg"}
                            </span>
                          </td>

                          {/* 5. Open PO (On Order) */}
                          <td className="px-4 py-3.5 text-right font-mono-code whitespace-nowrap">
                            {onOrder > 0 ? (
                              <span className="font-bold text-xs px-2 py-0.5 rounded-[3px] bg-[#006D77]/10 text-[#006D77] border border-[#006D77]/25">
                                +{formatQty(onOrder)} {item.uom || "Kg"}
                              </span>
                            ) : (
                              <span className="text-[#8a8780]">0.00 {item.uom || "Kg"}</span>
                            )}
                          </td>

                          {/* 6. Shortage / Qty To Purchase */}
                          <td className="px-4 py-3.5 text-right bg-[#c8102e]/[0.03] whitespace-nowrap">
                            {isShort ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-mono-code font-extrabold text-xs sm:text-sm px-3 py-1 rounded-[3px] bg-[#c8102e] text-white shadow-sm">
                                  BUY {formatQty(toBuy)} {item.uom || "Kg"}
                                </span>
                                {onOrder > 0 && (
                                  <span className="font-mono-code text-[10px] font-bold text-[#006D77]">
                                    Net after Open PO: {formatQty(netAfterPo)} {item.uom || "Kg"}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="font-mono-code font-bold text-xs px-2.5 py-1 rounded-[3px] bg-emerald-950/[0.08] text-emerald-800 border border-emerald-600/30">
                                ✓ Stock Sufficient (+{formatQty(surplus)} {item.uom || "Kg"} surplus)
                              </span>
                            )}
                          </td>

                          {/* 7. Last Pur. Rate & Est. Purchase Cost */}
                          <td className="px-4 py-3.5 text-right font-mono-code whitespace-nowrap">
                            <div className="font-bold text-sm text-[#1a1a1a]">
                              {isShort ? (
                                <span className="text-[#c8102e]">₹{formatInr(estCost)}</span>
                              ) : (
                                <span className="text-emerald-700">₹0.00</span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-[#6b6863]">
                              @ ₹{formatInr(lastPur)} / {item.uom || "Kg"}
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
        </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL 1: PLAN NEW PRODUCTION ORDER (POST /ProductionOrders)
      ===================================================================== */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
          <div className="rp-card max-w-4xl w-full bg-white overflow-hidden shadow-2xl my-8">
            <div className="px-6 py-4 bg-[#1a1a1a] text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#e8354d]">
                  SAP B1 SERVICE LAYER · POST /ProductionOrders
                </div>
                <h3 className="text-lg font-extrabold tracking-[-0.01em]">
                  Plan New Production Order
                </h3>
              </div>
              <button
                onClick={() => setShowPlanModal(false)}
                className="text-white/70 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {planError && (
                <div className="bg-[#c8102e]/[0.06] border-l-4 border-[#c8102e] p-3 text-xs text-[#c8102e] font-semibold">
                  {planError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Select Product with BOM (FG or SFG) *
                  </label>
                  <select
                    required
                    value={planItemCode}
                    onChange={e => {
                      const code = e.target.value;
                      setPlanItemCode(code);
                      const g = goods.find(item => item.code === code);
                      if (g?.warehouse) setPlanWarehouse(g.warehouse);
                    }}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2.5 text-sm font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  >
                    <option value="">-- Choose Product --</option>
                    <optgroup label="Finished Goods (FG)">
                      {goods
                        .filter(g => g.is_intermediate === 0)
                        .map(g => (
                          <option key={g.code} value={g.code}>
                            {g.code} — {g.name} (Stock: {formatQty(g.on_hand || 0)} Kg)
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Semi-Finished Goods / Sub-Assemblies (SFG)">
                      {goods
                        .filter(g => g.is_intermediate === 1)
                        .map(g => (
                          <option key={g.code} value={g.code}>
                            {g.code} — {g.name} (Stock: {formatQty(g.on_hand || 0)} Kg)
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Planned Quantity (Kg) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={planQty}
                    onChange={e => setPlanQty(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-mono-code font-bold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Target Warehouse *
                  </label>
                  <select
                    value={planWarehouse}
                    onChange={e => setPlanWarehouse(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  >
                    {warehouses.map(w => (
                      <option key={w.code} value={w.code}>
                        WH {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Due Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={planDueDate}
                    onChange={e => setPlanDueDate(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-mono-code bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Component Issue Method
                  </label>
                  <select
                    value={planIssueMethod}
                    onChange={e => setPlanIssueMethod(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  >
                    <option value="BOM">Keep BOM Default</option>
                    <option value="M">Manual Issue (Step-by-Step OIGE)</option>
                    <option value="B">Backflush (Auto-Consume on Receipt)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Remarks / Batch Notes
                  </label>
                  <input
                    type="text"
                    placeholder="Optional production batch or shift remarks..."
                    value={planRemarks}
                    onChange={e => setPlanRemarks(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center gap-2.5 bg-[#faf9f7] p-3 rounded-[4px] border border-black/[0.08]">
                  <input
                    id="autoReleaseCheck"
                    type="checkbox"
                    checked={planAutoRelease}
                    onChange={e => setPlanAutoRelease(e.target.checked)}
                    className="w-4 h-4 accent-[#c8102e]"
                  />
                  <label
                    htmlFor="autoReleaseCheck"
                    className="text-xs font-bold text-[#1a1a1a] cursor-pointer"
                  >
                    Release Production Order Immediately (`boposReleased`) so shop-floor can Issue &amp;
                    Receive right away
                  </label>
                </div>
              </div>

              {/* Live BOM Component Requirement & Stock Check Preview */}
              {planBomPreview.length > 0 && (
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#1a1a1a] mb-2">
                    BOM Component Requirements &amp; Live SAP Stock Check (for {formatQty(planQty)} Kg)
                  </div>
                  <div className="border border-black/[0.1] rounded-[4px] overflow-x-auto">
                    <table className="min-w-full divide-y divide-black/[0.08] text-xs">
                      <thead className="bg-[#f4f2ef]">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-[#444444]">
                            Component
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-bold uppercase text-[#444444]">
                            Issue Mode
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[#1a1a1a]">
                            Required Qty
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-emerald-800">
                            Available Stock (WH {planWarehouse})
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-bold uppercase text-[#444444]">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.05] bg-white">
                        {planBomPreview.map(c => (
                          <tr key={c.itemCode}>
                            <td className="px-3 py-2">
                              <span className="font-mono-code font-bold text-[#1a1a1a] mr-2">
                                {c.itemCode}
                              </span>
                              <span className="text-[#444444]">{c.itemName}</span>
                            </td>
                            <td className="px-3 py-2 text-center font-mono-code text-[11px]">
                              {c.issueMethod === "M" ? "Manual" : "Backflush"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-code font-bold text-[#1a1a1a]">
                              {formatQty(c.requiredQty, 3)} {c.uom}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-code font-bold text-emerald-700">
                              {formatQty(c.availableStock, 2)} {c.uom}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-[3px] ${
                                  c.isShort
                                    ? "bg-[#c8102e]/10 text-[#c8102e]"
                                    : "bg-emerald-950/[0.08] text-emerald-800"
                                }`}
                              >
                                {c.isShort ? "Low Stock" : "Stock OK"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="rp-btn rp-btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={planningOrder}
                  className="rp-btn rp-btn-red"
                >
                  {planningOrder
                    ? "Creating in SAP Service Layer..."
                    : planAutoRelease
                    ? "Create & Release Order in SAP"
                    : "Create Planned Order in SAP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: ISSUE COMPONENTS TO PRODUCTION (POST /InventoryGenExits)
      ===================================================================== */}
      {issueOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
          <div className="rp-card max-w-4xl w-full bg-white overflow-hidden shadow-2xl my-8">
            <div className="px-6 py-4 bg-[#1a1a1a] text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#e8354d]">
                  SAP B1 SERVICE LAYER · POST /InventoryGenExits (OIGE)
                </div>
                <h3 className="text-lg font-extrabold tracking-[-0.01em]">
                  Issue Components to Production — Order #{issueOrder.doc_num} ({issueOrder.item_code})
                </h3>
              </div>
              <button
                onClick={() => setIssueOrder(null)}
                className="text-white/70 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitIssue} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {issueError && (
                <div className="bg-[#c8102e]/[0.06] border-l-4 border-[#c8102e] p-3 text-xs text-[#c8102e] font-semibold">
                  {issueError}
                </div>
              )}

              <div className="bg-[#faf9f7] border border-black/[0.08] rounded-[4px] p-3.5 text-xs text-[#444444]">
                <strong>Note:</strong> Issuing components posts an{" "}
                <span className="font-mono-code font-bold text-[#1a1a1a]">
                  Issue for Production (OIGE)
                </span>{" "}
                in SAP Business One and deducts stock from the selected warehouse. Any line marked as{" "}
                <span className="font-semibold">Backflush</span> that you issue here will
                automatically be switched to <span className="font-semibold">Manual Issue</span> in
                SAP via Service Layer.
              </div>

              <div className="border border-black/[0.1] rounded-[4px] overflow-x-auto">
                <table className="min-w-full divide-y divide-black/[0.08] text-xs">
                  <thead className="bg-[#f4f2ef]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase text-[#444444]">
                        Component
                      </th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-[#444444]">
                        Planned
                      </th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-[#006D77]">
                        Already Issued
                      </th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-emerald-800">
                        Live WH Stock
                      </th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase text-[#444444]">
                        Warehouse
                      </th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-[#c8102e]">
                        Qty to Issue Now *
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] bg-white">
                    {issueLines.map((l, idx) => {
                      const reqNow = parseFloat(l.quantityToIssue || 0);
                      const isOverStock = reqNow > l.whsOnHand;
                      return (
                        <tr key={l.lineNum}>
                          <td className="px-3 py-2.5">
                            <div className="font-mono-code font-bold text-[#1a1a1a]">
                              {l.itemCode}
                            </div>
                            <div className="text-[11px] text-[#6b6863]">{l.itemName}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-code font-semibold">
                            {formatQty(l.plannedQty, 3)} {l.uom}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-code font-semibold text-[#006D77]">
                            {formatQty(l.issuedQty, 3)} {l.uom}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-code font-bold">
                            <span className={isOverStock ? "text-[#c8102e]" : "text-emerald-700"}>
                              {formatQty(l.whsOnHand, 2)} {l.uom}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <select
                              value={l.warehouse}
                              onChange={e =>
                                handleIssueLineChange(idx, "warehouse", e.target.value)
                              }
                              className="border border-black/[0.15] rounded-[3px] px-2 py-1 text-xs font-mono-code bg-white"
                            >
                              {warehouses.map(w => (
                                <option key={w.code} value={w.code}>
                                  WH {w.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={l.quantityToIssue}
                              onChange={e =>
                                handleIssueLineChange(idx, "quantityToIssue", e.target.value)
                              }
                              className="w-28 border border-black/[0.2] rounded-[4px] px-2.5 py-1.5 text-right font-mono-code font-bold text-xs focus:border-[#c8102e] focus:outline-none"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1">
                  SAP Journal / Issue Remarks
                </label>
                <input
                  type="text"
                  value={issueComments}
                  onChange={e => setIssueComments(e.target.value)}
                  className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-xs bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/[0.08]">
                <button
                  type="button"
                  onClick={() => setIssueOrder(null)}
                  className="rp-btn rp-btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingIssue}
                  className="rp-btn rp-btn-red"
                >
                  {submittingIssue
                    ? "Posting OIGE via Service Layer..."
                    : "Post Issue to Production in SAP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: RECEIPT FROM PRODUCTION / GET FROM PRODUCTION (POST /InventoryGenEntries)
      ===================================================================== */}
      {receiptOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
          <div className="rp-card max-w-3xl w-full bg-white overflow-hidden shadow-2xl my-8">
            <div className="px-6 py-4 bg-[#1a1a1a] text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">
                  SAP B1 SERVICE LAYER · POST /InventoryGenEntries (OIGN)
                </div>
                <h3 className="text-lg font-extrabold tracking-[-0.01em]">
                  Get from Production (Receipt) — Order #{receiptOrder.doc_num}
                </h3>
              </div>
              <button
                onClick={() => setReceiptOrder(null)}
                className="text-white/70 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSubmitReceipt}
              className="p-6 space-y-5 max-h-[82vh] overflow-y-auto"
            >
              {receiptError && (
                <div className="bg-[#c8102e]/[0.06] border-l-4 border-[#c8102e] p-3 text-xs text-[#c8102e] font-semibold">
                  {receiptError}
                </div>
              )}

              {/* Order Summary Banner */}
              <div className="grid grid-cols-3 gap-3 bg-[#faf9f7] p-4 rounded-[4px] border border-black/[0.08]">
                <div>
                  <div className="text-[10px] font-bold uppercase text-[#6b6863]">
                    Product to Receive
                  </div>
                  <div className="font-mono-code font-extrabold text-sm text-[#1a1a1a] mt-0.5">
                    {receiptOrder.item_code}
                  </div>
                  <div className="text-xs text-[#6b6863] truncate">{receiptOrder.item_name}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-[#6b6863]">
                    Planned Quantity
                  </div>
                  <div className="font-mono-code font-extrabold text-sm text-[#1a1a1a] mt-0.5">
                    {formatQty(receiptOrder.planned_qty)} {receiptOrder.uom || "Kg"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-emerald-800">
                    Already Received
                  </div>
                  <div className="font-mono-code font-extrabold text-sm text-emerald-700 mt-0.5">
                    {formatQty(receiptOrder.completed_qty)} {receiptOrder.uom || "Kg"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#1a1a1a] mb-1.5">
                    Completed Quantity to Receive (Kg) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={receiptQty}
                    onChange={e => setReceiptQty(e.target.value)}
                    className="w-full border border-black/[0.2] rounded-[4px] px-3.5 py-2 text-sm font-mono-code font-extrabold text-emerald-800 bg-white focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Rejected Quantity (Kg)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={receiptRejectedQty}
                    onChange={e => setReceiptRejectedQty(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-mono-code bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1.5">
                    Receiving Warehouse
                  </label>
                  <select
                    value={receiptWarehouse}
                    onChange={e => setReceiptWarehouse(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  >
                    {warehouses.map(w => (
                      <option key={w.code} value={w.code}>
                        WH {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Receipt Date (DocDate) & Shift UDF (U_Shift: Day / Night) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#1a1a1a] mb-1.5">
                    Receipt Date (Posting Date) *
                  </label>
                  <input
                    type="date"
                    required
                    value={receiptDate}
                    onChange={e => setReceiptDate(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-mono-code font-bold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#1a1a1a] mb-1.5">
                    Shift (SAP UDF: <span className="font-mono-code text-[#c8102e]">U_Shift</span>) *
                  </label>
                  <select
                    required
                    value={receiptShift}
                    onChange={e => setReceiptShift(e.target.value)}
                    className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-sm font-semibold bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                  >
                    <option value="Day">Day</option>
                    <option value="Night">Night</option>
                  </select>
                </div>
              </div>

              {/* Component Backflush / Issue Readiness Check */}
              {(receiptOrder.lines || []).length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#444444] mb-1.5">
                    Component Consumption Check for {formatQty(receiptQty)} Kg Receipt
                  </div>
                  <div className="border border-black/[0.08] rounded-[4px] overflow-x-auto">
                    <table className="min-w-full divide-y divide-black/[0.06] text-xs">
                      <thead className="bg-[#f4f2ef]">
                        <tr>
                          <th className="px-3 py-1.5 text-left text-[9.5px] font-bold uppercase">
                            Component
                          </th>
                          <th className="px-3 py-1.5 text-center text-[9.5px] font-bold uppercase">
                            Method
                          </th>
                          <th className="px-3 py-1.5 text-right text-[9.5px] font-bold uppercase">
                            Needed for Receipt
                          </th>
                          <th className="px-3 py-1.5 text-right text-[9.5px] font-bold uppercase">
                            WH Stock / Issued
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.05] bg-white">
                        {receiptOrder.lines.map(l => {
                          const recNum = parseFloat(receiptQty || 0);
                          const needed = Number(l.base_qty || 0) * (isNaN(recNum) ? 0 : recNum);
                          const isBackflush = l.issue_type !== "M";
                          const ok = isBackflush
                            ? Number(l.whs_on_hand || 0) >= needed
                            : Number(l.issued_qty || 0) >= needed;

                          return (
                            <tr key={l.line_num}>
                              <td className="px-3 py-1.5 font-mono-code font-bold text-[#1a1a1a]">
                                {l.item_code}{" "}
                                <span className="font-normal text-[#6b6863]">{l.item_name}</span>
                              </td>
                              <td className="px-3 py-1.5 text-center font-mono-code text-[10.5px]">
                                {isBackflush ? "Backflush (Auto)" : "Manual Issue"}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono-code font-semibold">
                                {formatQty(needed, 3)} {l.uom}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono-code font-bold">
                                <span className={ok ? "text-emerald-700" : "text-[#c8102e]"}>
                                  {isBackflush
                                    ? `Stock: ${formatQty(l.whs_on_hand, 2)} Kg`
                                    : `Issued: ${formatQty(l.issued_qty, 3)} Kg`}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#444444] mb-1">
                  Receipt Remarks
                </label>
                <input
                  type="text"
                  value={receiptComments}
                  onChange={e => setReceiptComments(e.target.value)}
                  className="w-full border border-black/[0.18] rounded-[4px] px-3.5 py-2 text-xs bg-white text-[#1a1a1a] focus:border-[#c8102e] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2.5 bg-[#faf9f7] p-3 rounded-[4px] border border-black/[0.08]">
                <input
                  id="autoCloseCheck"
                  type="checkbox"
                  checked={receiptAutoClose}
                  onChange={e => setReceiptAutoClose(e.target.checked)}
                  className="w-4 h-4 accent-[#c8102e]"
                />
                <label
                  htmlFor="autoCloseCheck"
                  className="text-xs font-bold text-[#1a1a1a] cursor-pointer"
                >
                  Close Production Order (`boposClosed`) automatically after posting this Receipt
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/[0.08]">
                <button
                  type="button"
                  onClick={() => setReceiptOrder(null)}
                  className="rp-btn rp-btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReceipt}
                  className="rp-btn rp-btn-red"
                >
                  {submittingReceipt
                    ? "Posting OIGN via Service Layer..."
                    : "Post Receipt from Production in SAP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
