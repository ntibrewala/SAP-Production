import { useState, useEffect } from 'react';

export default function Admin() {
  const [users, setUsers] = useState([]);
  
  // Form State
  const [editingId, setEditingId] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users');
      setUsers(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEditClick = (u) => {
    setEditingId(u.id);
    setUsername(u.username);
    setPassword(''); // leave blank so they don't have to change it unless they want to
    setRole(u.role);
    setError('');
    setSuccess('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setUsername('');
    setPassword('');
    setRole('user');
    setError('');
    setSuccess('');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
      fetchUsers();
      setSuccess('User deleted successfully!');
      if (editingId === id) handleCancelEdit();
    } catch (err) {
      setError('Server error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    try {
      const url = editingId ? `/api/auth/users/${editingId}` : '/api/auth/users';
      const method = editingId ? 'PUT' : 'POST';
      
      const payload = { username, role };
      if (password) payload.password = password;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setSuccess(editingId ? 'User updated successfully!' : 'User created successfully!');
        handleCancelEdit();
        fetchUsers();
      } else {
        setError(data.message || 'Failed to save user');
      }
    } catch (err) {
      setError('Server error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
         <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">
          {editingId ? 'Edit User' : 'Add New User'}
        </h3>
        
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        {success && <div className="bg-green-50 text-green-600 p-3 rounded-lg mb-4 text-sm">{success}</div>}

        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input 
              type="text" required
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={username} onChange={e => setUsername(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password {editingId && <span className="text-gray-400 font-normal">(Leave blank to keep same)</span>}
            </label>
            <input 
              type="password" required={!editingId}
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="w-32">
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              value={role} onChange={e => setRole(e.target.value)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 h-11">
              {editingId ? 'Update' : 'Add User'}
            </button>
            {editingId && (
              <button type="button" onClick={handleCancelEdit} className="bg-gray-100 text-gray-700 border border-gray-300 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-200 h-11">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map(u => (
              <tr key={u.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{u.id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{u.username}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                  <button onClick={() => handleEditClick(u)} className="text-blue-600 hover:text-blue-900">Edit</button>
                  <button onClick={() => handleDelete(u.id)} className="text-red-600 hover:text-red-900">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
