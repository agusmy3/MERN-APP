import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllKategori,
  getKategori,
  createKategori,
  updateKategori,
  deleteKategori
} from '../services/kategoriService';
import { useAuth } from '../context/AuthContext';
import Pagination from "../components/Pagination";

export default function Kategori() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: '', deskripsi: '' });
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [totalItems, setTotalItems] = useState(0);
  const [sortField, setSortField] = useState('createdDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    if (!user) return navigate('/login');
    loadData();
    }, [
    currentPage,
    pageSize,
    search,
    sortField,
    sortOrder,
  ]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setCurrentPage(1);
    }, 500);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  const loadData = async () => {
    try {
      const res = await getKategori(user.token, {
        search,
        page: currentPage,
        pageSize,
        sortField,
        sortOrder,
      });

      setList(res.data.data);
      setTotalItems(res.data.totalData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateKategori(editing, form, user.token);
      } else {
        await createKategori(form, user.token);
      }
      setForm({ name: '', deskripsi: '' });
      setEditing(null);
      loadData();
    } catch (err) {
      alert('Gagal simpan kategori');
    }
  };

  const handleEdit = (item) => {
    setForm({ name: item.name, deskripsi: item.deskripsi });
    setEditing(item._id);
  };

  const handleCancelEdit = () => {
    setForm({ name: '', deskripsi: '' });
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus?')) return;
    await deleteKategori(id, user.token);
    loadData();
  };

  return (
    <div  className='h-full p-4 flex flex-col'>
      <h1 className="text-2xl/7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight mb-4 py-1 shrink-0">Manajemen Kategori</h1>
      <div className="min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/3 w-full p-4 bg-white shadow rounded flex-1 min-h-0 overflow-auto">
          <form onSubmit={handleSubmit} className="mb-6 bg-white space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama Kategori</label>
              <input
                type="text"
                name="name"
                placeholder="Nama kategori"
                autoComplete='off'
                value={form.name}
                onChange={handleChange}
                className="
                  w-full 
                  border-b
                  border-b-gray-300
                  focus:outline-0 focus:border-b-sky-400 
                  px-4 py-2 
                  rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Deskripsi Kategori</label>
              <textarea
                name="deskripsi"
                placeholder="Deskripsi kategori"
                value={form.deskripsi}
                onChange={handleChange}
                className="
                  w-full 
                  border-b
                  border-b-gray-300
                  focus:outline-0 focus:border-b-sky-400 
                  px-4 py-2 
                  rounded"
              />
            </div>
            <div>
              {!editing &&
                <>
                  <button type="submit" className="bg-blue-600 text-white px-4 py-2 cursor-pointer rounded hover:bg-blue-700">Tambah</button>
                </>
              }
              {editing && 
                <>
                  <button type="submit" className="bg-yellow-600 text-white px-4 py-2 cursor-pointer rounded hover:bg-yellow-700">Update</button>                  
                </>
              }
              <button type="button" className="bg-red-600 text-white px-4 py-2 mx-2 cursor-pointer rounded hover:bg-red-700" onClick={handleCancelEdit}>Batal</button>
            </div>
            
          </form>
        </div>
        <div className="lg:w-2/3 w-full min-h-0 flex flex-col p-4 bg-white shadow rounded">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 mb-1">Search</label>
            <input
              type="text"
              placeholder="Type Keyword..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="
              w-full 
              border-b
              border-b-gray-300
              focus:outline-0 focus:border-b-sky-400 
              px-4 py-2 
              rounded"
            />
          </div>
          <div className='min-h-0 flex-1 overflow-auto'>
            <table className="w-full bg-white shadow rounded border-separate border-spacing-0">
              <thead className="bg-blue-600 text-white sticky top-0 z-10">
                <tr>
                  <th rowSpan='2' className="px-4 py-2 border">No</th>
                  <th
                    rowSpan='2' 
                    className="cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("name");
                      setSortOrder(
                        sortField === "name" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>Name</span>
                      <i
                        className={`fa ${
                          sortField === "name"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th rowSpan='2' className="px-4 py-2 border">Description</th>
                  <th colSpan='2' className="px-4 py-2 border">Created</th>
                  <th colSpan='2' className="px-4 py-2 border">Updated</th>
                  <th rowSpan='2' className="px-4 py-2 border">Action</th>
                </tr>
                <tr>
                  <th 
                    className="cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("createdDate");
                      setSortOrder(
                        sortField === "createdDate" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>Date</span>
                      <i
                        className={`fa ${
                          sortField === "createdDate"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th className="px-4 py-2 border">By</th>
                  <th 
                    className="cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("updatedDate");
                      setSortOrder(
                        sortField === "updatedDate" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>Date</span>
                      <i
                        className={`fa ${
                          sortField === "updatedDate"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th className="px-4 py-2 border">By</th>
                </tr>
              </thead>
              <tbody className='text-sm'>
                {list.map((kategori, index) => (
                  <tr key={kategori._id}>
                    <td className="px-4 py-2 border-t border-t-black">{(currentPage - 1) * pageSize + index + 1}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.name}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.deskripsi || '-'}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.createdDate}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.createdBy?.name}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.updatedDate || '-'}</td>
                    <td className="px-4 py-2 border-t border-t-black">{kategori.updatedBy?.name || '-'}</td>
                    <td className="px-4 py-2 border-t border-t-black text-nowrap">
                      <button
                        type="button"
                        onClick={() => handleEdit(kategori)}
                        className="bg-yellow-600 hover:bg-yellow-700 cursor-pointer text-white w-8 h-8 rounded mr-2"
                      >
                        <i className='fa fa-pen text-xs'></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(kategori._id)}
                        className="bg-red-600 hover:bg-red-700 cursor-pointer text-white w-8 h-8 rounded"
                      >
                        <i className='fa fa-trash text-xs'></i>
                      </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan="6" className="text-center py-4 text-gray-500">
                      Belum ada data kategori
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <Pagination
              currentPage={currentPage}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
            />
          </div>
          
        </div>
      </div>
    </div>
  );
}
