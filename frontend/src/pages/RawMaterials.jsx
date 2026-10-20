import { useState, useEffect } from 'react';

export default function RawMaterials() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // New material form
  const [name, setName] = useState('');
  const [uom, setUom] = useState('kg');
  const [unitCost, setUnitCost] = useState('');
  const [stock, setStock] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  const fetchMaterials = async () => {
    try {
      const res = await fetch('/api/materials');
      const data = await res.json();
      setMaterials(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, uom, unit_cost: unitCost, stock_level: stock })
      });
      const data = await res.json();
      if (data.error && data.error.includes('Duplicate')) {
        alert("This material already exists! Double entry is disabled.");
        return;
      }
      setName('');
      setUnitCost('');
      setStock('');
      fetchMaterials();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditClick = (material) => {
    setEditingId(material.id);
    setEditFormData({
      name: material.name,
      uom: material.uom,
      unit_cost: material.unit_cost,
      stock_level: material.stock_level
    });
  };

  const handleSaveEdit = async (id) => {
    try {
      await fetch(`/api/materials/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData)
      });
      setEditingId(null);
      fetchMaterials();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800">Raw Materials & Costing</h2>
      
      {/* Add New Material Form */}
      <div className="bg-white p-4 rounded-xl shadow-sm border">
        <h3 className="text-lg font-medium mb-4">Add New Material</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <input 
            type="text" placeholder="Material Name" required className="border p-2 rounded col-span-2"
            value={name} onChange={e => setName(e.target.value)}
          />
          <select value={uom} onChange={e => setUom(e.target.value)} className="border p-2 rounded">
            <option value="kg">kg</option>
            <option value="liters">liters</option>
            <option value="pieces">pieces</option>
            <option value="meters">meters</option>
          </select>
          <input 
            type="number" step="0.01" placeholder="Cost per unit" required className="border p-2 rounded"
            value={unitCost} onChange={e => setUnitCost(e.target.value)}
          />
          <input 
            type="number" step="0.01" placeholder="Initial Stock" required className="border p-2 rounded"
            value={stock} onChange={e => setStock(e.target.value)}
          />
          <button type="submit" className="md:col-span-5 bg-blue-600 text-white p-2 rounded font-medium hover:bg-blue-700">
            Add Material
          </button>
        </form>
      </div>

      {/* Materials List */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stock</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit Cost</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {materials.map(m => (
              <tr key={m.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingId === m.id ? (
                    <input type="text" className="border p-1 rounded w-full" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} />
                  ) : m.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingId === m.id ? (
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.001" className="border p-1 rounded w-24" value={editFormData.stock_level} onChange={e => setEditFormData({...editFormData, stock_level: e.target.value})} />
                      <span className="text-sm text-gray-500">{m.uom}</span>
                    </div>
                  ) : (
                    <span className={`font-medium ${m.stock_level < 10 ? 'text-red-600' : 'text-gray-900'}`}>
                      {parseFloat(m.stock_level).toFixed(3)} {m.uom}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                  {editingId === m.id ? (
                    <div className="flex items-center gap-1">
                      <span>₹</span>
                      <input type="number" step="0.01" className="border p-1 rounded w-20" value={editFormData.unit_cost} onChange={e => setEditFormData({...editFormData, unit_cost: e.target.value})} />
                    </div>
                  ) : (
                    `₹${m.unit_cost}`
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  {editingId === m.id ? (
                    <div className="space-x-2">
                      <button onClick={() => handleSaveEdit(m.id)} className="text-green-600 hover:text-green-800 font-medium">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => handleEditClick(m)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {materials.length === 0 && (
              <tr><td colSpan="4" className="px-6 py-4 text-center text-gray-500">No raw materials found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
