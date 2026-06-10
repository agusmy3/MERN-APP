import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllProduk,
  createProduk,
  updateProduk,
  deleteProduk
} from '../services/produkService';
import { getAllKategori } from '../services/kategoriService';
import { useAuth } from '../context/AuthContext';

export default function Produk() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [list, setList] = useState([]);
  const [listKategoris, setListKategoris] = useState([]);
  const [form, setForm] = useState({ name: '', deskripsi: '', harga: 0, qty: 0, kategori: '' });
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!user) return navigate('/login');
    loadData();
  }, []);

  const loadData = async () => {
    const produk = await getAllProduk(user.token);
    const kategori = await getAllKategori(user.token);
    setList(produk);
    setListKategoris(kategori);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateProduk(editing, form, user.token);
      } else {
        await createProduk(form, user.token);
      }
      setForm({ name: '', deskripsi: '', harga: 0, qty: 0, kategori: '' });
      setEditing(null);
      loadData();
    } catch (err) {
      alert('Gagal simpan produk');
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleEdit = (item) => {
    setForm({
      name: item.name,
      deskripsi: item.deskripsi,
      harga: item.harga,
      qty: item.qty,
      kategori: item.kategori?._id || ''
    });
    setEditing(item._id);
  };

  const handleCancelEdit = () => {
    setForm({ name: '', deskripsi: '', harga: 0, qty: 0, kategori: '' });
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus?')) return;
    await deleteProduk(id, user.token);
    loadData();
  };

  return (
    <div className='p-4'>
      <h1 className="text-2xl/7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight mb-4 py-1">Manajemen Produk</h1>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/3 w-full">
          <form onSubmit={handleSubmit} className="bg-white p-4 shadow rounded-md space-y-4">
            <label className="block text-sm font-medium text-gray-600 mb-1">Nama Produk</label>
            <input
              type="text"
              name="name"
              placeholder="Nama produk"
              autoComplete="off"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded"
            />
            <label className="block text-sm font-medium text-gray-600 mb-1">Deskripsi</label>
            <textarea
              name="deskripsi"
              placeholder="Deskripsi"
              value={form.deskripsi}
              onChange={handleChange}
              className="w-full px-4 py-2 border rounded"
            />
            <label className="block text-sm font-medium text-gray-600 mb-1">Harga</label>
            <input
              type="number"
              name="harga"
              placeholder="Harga"
              value={form.harga}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded"
            />
            <label className="block text-sm font-medium text-gray-600 mb-1">Quantity</label>
            <input
              type="number"
              name="qty"
              placeholder="Qty"
              value={form.qty}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded"
            />
            <label className="block text-sm font-medium text-gray-600 mb-1">Kategori</label>
            <select
              name="kategori"
              value={form.kategori}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded"
            >
              <option value="">Pilih Kategori</option>
              {listKategoris.map((k) => (
                <option key={k._id} value={k._id}>
                  {k.name}
                </option>
              ))}
            </select>
            {!editing &&
              <>
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Tambah</button>
                <button type="button" className="bg-red-600 text-white px-4 py-2 mx-2 rounded hover:bg-red-700" onClick={handleCancelEdit}>Batal</button>
              </>
            }
            {editing && 
              <>
                <button type="submit" className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700">Update</button>
                <button type="button" className="bg-red-600 text-white px-4 py-2 mx-2 rounded hover:bg-red-700" onClick={handleCancelEdit}>Batal</button>
              </>
            }
          </form>
        </div>
        <div className="lg:w-2/3 w-full">
          <table className="w-full bg-white shadow rounded overflow-hidden">
            <thead className="bg-blue-600 text-white">
              <tr>
                <th className="text-left px-4 py-2">Nama</th>
                <th className="text-left px-4 py-2">Deskripsi</th>
                <th className="text-left px-4 py-2">Harga</th>
                <th className="text-left px-4 py-2">Qty</th>
                <th className="text-left px-4 py-2">Kategori</th>
                <th className="text-left px-4 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((produk) => (
                <tr key={produk._id} className="border-t">
                  <td className="px-4 py-2">{produk.name}</td>
                  <td className="px-4 py-2">{produk.deskripsi}</td>
                  <td className="px-4 py-2">{produk.harga}</td>
                  <td className="px-4 py-2">{produk.qty}</td>
                  <td className="px-4 py-2">{produk.kategori?.name || "-"}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(produk)}
                      className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded"
                    >
                      <i className='fa fa-pen'></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(produk._id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded mx-2"
                    >
                      <i className='fa fa-trash'></i>
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center py-4 text-gray-500">
                    Belum ada data produk
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
  );
}
