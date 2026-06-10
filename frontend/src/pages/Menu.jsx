import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Pagination from "../components/Pagination";
import {
  getMenus,
  createMenu,
  updateMenu,
  deleteMenu
} from '../services/menuService';
import { useAuth } from '../context/AuthContext';

export default function Menu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [form, setForm] = useState({
    menu: '',
    parent_id: '',
    component: '',
    img: '',
    icon: ''
  });
  const [editing, setEditing] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  useEffect(() => {
    if (!user) return navigate('/login');
    loadData();
  }, []);

  const loadData = async () => {
    const res = await getMenus(user.token);
    setList(res);
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editing) {
      await updateMenu(editing, form, user.token);
      setEditing(null);
    } else {
      await createMenu(form, user.token);
    }
    setForm({ menu: '', parent_id: '', component: '', img: '', icon: '' });
    loadData();
  };

  const handleEdit = (menu) => {
    setForm({
      menu: menu.menu,
      parent_id: menu.parent_id?._id || '',
      component: menu.component || '',
      img: menu.img || '',
      icon: menu.icon || ''
    });
    setEditing(menu._id);
  };

  const handleCancelEdit = () => {
    setForm({ menu: '', parent_id: '', component: '', img: '', icon: '' });
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteMenu(id, user.token);
    loadData();
  };

  const totalItems = list.length;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = list.slice(startIndex, endIndex);

  return (
    
    <div className='h-full p-4 flex flex-col'>
      <h1 className="text-2xl/7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight mb-4 py-1 shrink-0">Manajemen Menu</h1>
      <div className="min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/3 w-full p-4 bg-white shadow rounded flex-1 min-h-0 overflow-auto">
          <form onSubmit={handleSubmit} className='mb-6 bg-white space-y-4'>
            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Nama Menu</label>
              <input
                type='text'
                name='menu'
                value={form.menu}
                onChange={handleChange}
                autoComplete='off'
                className='
                  w-full 
                  border-b border-b-gray-300 
                  focus:outline-0 focus:border-b-sky-400 
                  rounded 
                  px-4 py-2'
                required
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Parent</label>
              <select
                name='parent_id'
                value={form.parent_id}
                onChange={handleChange}
                autoComplete='off'
                className='
                  text-gray-600
                  w-full 
                  border-b border-b-gray-300 
                  focus:outline-0 focus:border-b-sky-400 
                  rounded 
                  px-4 py-2'
              >
                <option value=''>-- Tidak Ada (Root) --</option>
                {list.filter((m) => m._id !== editing).map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.menu}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Component</label>
              <input
                type='text'
                name='component'
                value={form.component}
                onChange={handleChange}
                autoComplete='off'
                className='
                  w-full 
                  border-b border-b-gray-300 
                  focus:outline-0 focus:border-b-sky-400 
                  rounded 
                  px-4 py-2'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Icon</label>
              <input
                type='text'
                name='icon'
                value={form.icon}
                onChange={handleChange}
                autoComplete='off'
                className='
                  w-full 
                  border-b border-b-gray-300 
                  focus:outline-0 focus:border-b-sky-400 
                  rounded 
                  px-4 py-2'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Gambar</label>
              <input
                type='text'
                name='img'
                value={form.img}
                onChange={handleChange}
                autoComplete='off'
                className='
                  w-full 
                  border-b border-b-gray-300 
                  focus:outline-0 focus:border-b-sky-400 
                  rounded 
                  px-4 py-2'
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
          <div className='min-h-0 flex-1 overflow-auto'>
            <table className='w-full bg-white shadow rounded'>
              <thead className='bg-blue-600 text-white sticky top-0 z-10'>
                <tr className='overflow-x-hidden'>
                  <th className='px-4 py-2'>No</th>
                  <th className='px-4 py-2'>Parent</th>
                  <th className='px-4 py-2'>Menu</th>
                  <th className='px-4 py-2'>Component</th>
                  <th className='px-4 py-2'>Icon</th>
                  <th className='px-4 py-2'>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((m, index) => (
                  <tr key={m._id} className='border-t'>
                    <td className='px-4 py-2'>{startIndex + index + 1}</td>
                    <td className='px-4 py-2'>{m.parent_id?.menu || '-'}</td>
                    <td className='px-4 py-2'>{m.menu}</td>
                    <td className='px-4 py-2'>{m.component || '-'}</td>
                    <td className='px-4 py-2'>{m.icon || '-'}</td>
                    <td className='px-4 py-2 space-x-2'>
                      <button
                          type="button"
                          onClick={() => handleEdit(m)}
                          className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 cursor-pointer rounded"
                        >
                          <i className='fa fa-pen'></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(m._id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 cursor-pointer rounded mx-2"
                        >
                          <i className='fa fa-trash'></i>
                        </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan='6' className='text-center py-4 text-gray-500'>
                      Tidak ada data
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
