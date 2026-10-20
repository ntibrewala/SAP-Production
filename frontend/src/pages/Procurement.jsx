import { useState, useEffect } from 'react';

export default function Procurement() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchProcurement = async () => {
    try {
      const res = await fetch('/api/materials/procurement');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProcurement(); }, []);

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Material Planning & Procurement</h2>
        <p className="text-gray-500 text-sm mt-1">Calculates raw materials needed across all "Planned" production runs.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Raw Material</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Current Stock</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Needed for Production</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Shortage (To Order)</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map(item => (
              <tr key={item.raw_material_id}>
                <td className="px-6 py-4 font-medium text-gray-800">{item.name}</td>
                <td className="px-6 py-4 text-right text-gray-600">{item.stock_level} {item.uom}</td>
                <td className="px-6 py-4 text-right text-indigo-600 font-medium">
                  {Number(item.needed_for_planned).toFixed(2)} {item.uom}
                </td>
                <td className={`px-6 py-4 text-right font-bold ${
                  item.shortage > 0 ? 'text-red-600 bg-red-50' : 'text-green-600'
                }`}>
                  {item.shortage > 0 ? `${Number(item.shortage).toFixed(2)} ${item.uom}` : 'OK'}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan="4" className="px-6 py-4 text-center text-gray-500">No raw materials found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
