import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Pagination from "../components/Pagination";
import {
  getAllMenus,
  getMenus,
  createMenu,
  updateMenu,
  deleteMenu
} from '../services/menuService';
import { useAuth } from '../context/AuthContext';

export default function Menu() {
  const initForm = {
    menu: '',
    parent_id: '',
    component: '',
    img: '',
    icon: ''
  }
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [listAll, setListAll] = useState([]);
  const [form, setForm] = useState(initForm);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [totalItems, setTotalItems] = useState(0);
  const [sortField, setSortField] = useState('createdDate');
  const [sortOrder, setSortOrder] = useState('asc');
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
      const res = await getMenus(user.token, {
        search,
        page: currentPage,
        pageSize,
        sortField,
        sortOrder,
      });

      if (res.data.success) {
        setList(res.data.data.dataMenu);
        setTotalItems(res.data.data.totalData);

        const resAll = await getAllMenus(user.token);
        setListAll(resAll.data.data);
      }  
    } catch (err) {
      console.error(err);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editing) {
      const res = await updateMenu(editing, form, user.token);
      alert(res.data.message);
    } else {
      const res = await createMenu(form, user.token);
      alert(res.data.message);
    }

    setForm(initForm);
    setEditing(null);
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
    setForm(initForm);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    try{
      if (!confirm('Are you sure to delete data?')) return;
      const res = await deleteMenu(id, user.token);
      alert(res.data.message);
      loadData();
    }catch(err){
      console.error(err);
    }
  };

  return (
    
    <div className='h-full p-4 flex flex-col'>
      <h1 className="text-2xl/7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight mb-4 py-1 shrink-0">Managament of Menu</h1>
      <div className="min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/3 w-full p-4 bg-white shadow rounded flex-1 min-h-0 overflow-auto">
          <form onSubmit={handleSubmit} className='mb-6 bg-white space-y-4'>
            <div>
              <label className='block text-sm font-medium text-gray-600 mb-1'>Name</label>
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
                <option value=''>-- (Root) --</option>
                {listAll.filter((m) => m._id !== editing).map((p) => (
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
              <label className='block text-sm font-medium text-gray-600 mb-1'>Image</label>
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
              <button 
                type="submit" 
                className={`
                  text-white 
                  px-4 py-2 
                  cursor-pointer 
                  rounded
                  ${
                    (!editing) ? "bg-blue-600 hover:bg-blue-700" : "bg-yellow-600 hover:bg-yellow-700"
                  }`}
              >
                <i className='fa fa-save'></i> Save
              </button>
              <button type="button" className="bg-red-600 text-white px-4 py-2 mx-2 cursor-pointer rounded hover:bg-red-700" onClick={handleCancelEdit}><i className='fa fa-close'></i> Cancel</button>
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
            <table className='w-full bg-white shadow rounded border-separate border-spacing-0'>
              <thead className='bg-blue-600 text-white sticky top-0 z-10'>
                <tr>
                  <th rowspan='2' className='px-4 py-2 border'>No</th>
                  <th 
                    rowspan='2'
                    className="cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("parent_id");
                      setSortOrder(
                        sortField === "parent_id" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex justify-center items-center gap-2">
                      <span>Parent</span>
                      <i
                        className={`fa ${
                          sortField === "parent_id"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th
                    rowspan='2' 
                    className="cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("menu");
                      setSortOrder(
                        sortField === "menu" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex justify-center items-center gap-2">
                      <span>Menu</span>
                      <i
                        className={`fa ${
                          sortField === "menu"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th rowspan='2' className='px-4 py-2 border'>Component</th>
                  <th rowspan='2' className='px-4 py-2 border'>Icon</th>
                  <th colspan='2' className='px-4 py-2 border'>Created</th>
                  <th colspan='2' className='px-4 py-2 border'>Updated</th>
                  <th rowspan='2' className='px-4 py-2 border'>Action</th>
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
                    <div className="flex justify-center items-center gap-2">
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
                  <th className='px-4 py-2 border'>By</th>
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
                    <div className="flex justify-center items-center gap-2">
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
                  <th className='px-4 py-2 border'>By</th>
                </tr>
              </thead>
              <tbody className='text-sm'>
                {list.map((m, index) => (
                  <tr key={m._id}>
                    <td className='px-4 py-2 border-t border-t-black text-center'>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.parent_id?.menu || '-'}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.menu}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.component || '-'}</td>
                    <td className='px-4 py-2 border-t border-t-black text-nowrap'><i className={m.icon || ''}></i> {m.icon || '-'}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.createdDate}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.createdBy?.name}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.updatedDate || '-'}</td>
                    <td className='px-4 py-2 border-t border-t-black'>{m.updatedBy?.name || '-'}</td>
                    <td className='px-4 py-2 border-t border-t-black text-nowrap'>
                      <button
                          type="button"
                          onClick={() => handleEdit(m)}
                          className="bg-yellow-600 hover:bg-yellow-700 text-white h-8 w-8 cursor-pointer rounded mr-2"
                        >
                          <i className='fa fa-pen text-xs'></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(m._id)}
                          className="bg-red-600 hover:bg-red-700 text-white h-8 w-8 cursor-pointer rounded"
                        >
                          <i className='fa fa-trash text-xs'></i>
                        </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan='10' className='text-center py-4 text-gray-500'>
                      Data Category is Empty
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
