import { useState, useEffect } from 'react';

export default function Production() {
  const [runs, setRuns] = useState([]);
  const [goods, setGoods] = useState([]);
  
  const [selectedGood, setSelectedGood] = useState('');
  const [quantity, setQuantity] = useState('');

  const [confirmingId, setConfirmingId] = useState(null);
  const [expectedData, setExpectedData] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');

  const fetchData = async () => {
    try {
      const [runsRes, goodsRes] = await Promise.all([
        fetch('/api/production'),
        fetch('/api/materials/goods')
      ]);
      setRuns(await runsRes.json());
      setGoods(await goodsRes.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handlePlan = async (e) => {
    e.preventDefault();
    try {
      await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finished_good_id: selectedGood, quantity_planned: quantity })
      });
      setSelectedGood('');
      setQuantity('');
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const startConfirm = async (id) => {
    try {
      const res = await fetch(`/api/production/${id}/expected-materials`);
      const data = await res.json();
      setExpectedData(data);
      setConfirmingId(id);
    } catch (err) {
      console.error(err);
    }
  };

  const submitConfirm = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        quantity_actual: expectedData.quantity_planned,
        materials: expectedData.materials.map(m => ({
          raw_material_id: m.raw_material_id,
          quantity_actual: m.expected_quantity
        }))
      };

      await fetch(`/api/production/${confirmingId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setConfirmingId(null);
      setExpectedData(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExpectedChange = (index, val) => {
    const updated = { ...expectedData };
    updated.materials[index].expected_quantity = val;
    setExpectedData(updated);
  };

  const filteredRuns = runs.filter(r => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (dateFilter) {
      // created_at is a full ISO timestamp, split to get just the local date part for comparison
      // careful: new Date(created_at) might shift timezones. Simple prefix match is safer if stored as ISO
      const runDate = new Date(r.created_at).toLocaleDateString('en-CA'); // gets YYYY-MM-DD in local time
      if (runDate !== dateFilter) return false;
    }
    return true;
  }).sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800">Production Entry</h2>

      <div className="bg-white p-4 rounded-xl shadow-sm border">
        <h3 className="font-medium mb-4 text-gray-700">Plan New Production Run</h3>
        <form onSubmit={handlePlan} className="flex flex-col sm:flex-row gap-4">
          <select 
            required className="border p-2 rounded flex-1"
            value={selectedGood} onChange={e => setSelectedGood(e.target.value)}
          >
            <option value="">Select Product...</option>
            {goods.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <input 
            type="number" placeholder="Target Quantity" required className="border p-2 rounded sm:w-48"
            value={quantity} onChange={e => setQuantity(e.target.value)}
          />
          <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded font-medium hover:bg-indigo-700">
            Create Plan
          </button>
        </form>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-end bg-white p-4 rounded-xl shadow-sm border gap-4">
        <div className="flex flex-wrap gap-4 items-center w-full sm:w-auto">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Status Filter</label>
            <select className="border border-gray-300 p-2 rounded-lg text-sm w-full bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="Planned">Not-Completed (Planned)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Date Filter</label>
            <div className="flex gap-2">
              <input type="date" className="border border-gray-300 p-2 rounded-lg text-sm w-full bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
              {dateFilter && <button onClick={() => setDateFilter('')} className="text-gray-400 hover:text-red-500 px-2 py-1" title="Clear Date">✖</button>}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Sort by Date</label>
          <select className="border border-gray-300 p-2 rounded-lg text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
            <option value="asc">Ascending (Oldest First)</option>
            <option value="desc">Descending (Newest First)</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Planned</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actual</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRuns.length === 0 ? (
               <tr><td colSpan="6" className="p-8 text-center text-gray-500 italic">No production runs match your filters.</td></tr>
            ) : filteredRuns.map(r => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-sm">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 font-medium">{r.finished_good_name}</td>
                <td className="px-4 py-3 text-center">{r.quantity_planned}</td>
                <td className="px-4 py-3 text-center text-gray-500">{r.quantity_actual || '-'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    r.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {r.status === 'Planned' && (
                    <button 
                      onClick={() => startConfirm(r.id)}
                      className="text-indigo-600 hover:text-indigo-900 text-sm font-medium border border-indigo-200 px-3 py-1 rounded bg-indigo-50"
                    >
                      Complete (Tick)
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation Modal */}
      {confirmingId && expectedData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-2">Confirm Actuals</h3>
            <p className="text-gray-500 text-sm mb-6">Verify the quantities before completing. Actual materials used will be deducted from inventory.</p>
            
            <form onSubmit={submitConfirm} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Actual Goods Produced</label>
                <input 
                  type="number" className="border p-2 w-full rounded"
                  value={expectedData.quantity_planned}
                  onChange={(e) => setExpectedData({...expectedData, quantity_planned: e.target.value})}
                />
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2 mt-4">Actual Raw Materials Consumed</h4>
                <div className="bg-gray-50 border rounded-lg p-3 space-y-3 max-h-60 overflow-y-auto">
                  {expectedData.materials.map((m, idx) => (
                    <div key={m.raw_material_id} className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">{m.name} ({m.uom})</span>
                      <input 
                        type="number" step="0.0001" className="border p-1 w-24 rounded text-right"
                        value={m.expected_quantity}
                        onChange={(e) => handleExpectedChange(idx, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setConfirmingId(null)} className="px-4 py-2 border rounded text-gray-600">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700">Confirm & Complete</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
