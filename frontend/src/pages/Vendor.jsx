import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllVendor,
  getVendor,
  createVendor,
  updateVendor,
  deleteVendor
} from '../services/vendorService';
import { useAuth } from '../context/AuthContext';
import Pagination from "../components/Pagination";

export default function Vendor() {
  const intiForm = {
    companyName: '',
    picName: '',
    picContact: '',
    companyAddress: '',
  }
  const [list, setList] = useState([]);
  const [form, setForm] = useState(intiForm);
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
      const res = await getVendor(user.token, {
        search,
        page: currentPage,
        pageSize,
        sortField,
        sortOrder,
      });

      if (res.data.success) {
        setList(res.data.data.dataVendor);
        setTotalItems(res.data.data.totalData);
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
    try {
      if (editing) {
        const res = await updateVendor(editing, form, user.token);
        alert(res.data.message);
      } else {
        const res = await createVendor(form, user.token);
        alert(res.data.message);
      }

      setForm(intiForm);
      setEditing(null);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = (item) => {
    setForm({ 
      picName: item.picName, 
      picContact: item.picContact,
      companyName: item.companyName,
      companyAddress: item.companyAddress 
    });
    setEditing(item._id);
  };

  const handleCancelEdit = () => {
    setForm(intiForm);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    try{
      if (!confirm('Are you sure to delete data?')) return;
      const res = await deleteVendor(id, user.token);
      alert(res.data.message);
      loadData();
    }catch(err){
      console.error(err);
    }
  };

  return (
    <div  className='h-full p-4 flex flex-col'>
      <h1 className="text-2xl/7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight mb-4 py-1 shrink-0">Managament of Vendor</h1>
      <div className="min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/3 w-full p-4 bg-white shadow rounded flex-1 min-h-0 overflow-auto">
          <form onSubmit={handleSubmit} className="mb-6 bg-white space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">PIC Name</label>
              <input
                type="text"
                name="picName"
                placeholder="PIC Name"
                autoComplete='off'
                value={form.picName}
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
              <label className="block text-sm font-medium text-gray-600 mb-1">PIC Contact</label>
              <input
                type="text"
                name="picContact"
                placeholder="Contact : 08xxx"
                autoComplete='off'
                value={form.picContact}
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
              <label className="block text-sm font-medium text-gray-600 mb-1">Company Name</label>
              <input
                type="text"
                name="companyName"
                placeholder="Company Name"
                autoComplete='off'
                value={form.companyName}
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
              <label className="block text-sm font-medium text-gray-600 mb-1">Company Address</label>
              <textarea
                name="companyAddress"
                placeholder="Company Address"
                value={form.companyAddress}
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
            <table className="w-full bg-white shadow rounded border-separate border-spacing-0">
              <thead className="bg-blue-600 text-white sticky top-0 z-10">
                <tr>
                  <th rowSpan='2' className="px-4 py-2 border">No</th>
                  <th colSpan='2' className="px-4 py-2 border">PIC</th>
                  <th colSpan='2' className="px-4 py-2 border">Company</th>
                  <th colSpan='2' className="px-4 py-2 border">Created</th>
                  <th colSpan='2' className="px-4 py-2 border">Updated</th>
                  <th rowSpan='2' className="px-4 py-2 border">Action</th>
                </tr>
                <tr>
                  <th 
                    className="text-left cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("picName");
                      setSortOrder(
                        sortField === "picName" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex justify-center items-center gap-2">
                      <span>Name</span>
                      <i
                        className={`fa ${
                          sortField === "picName"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th className="text-left px-4 py-2 border">Contact</th>
                  <th 
                    className="text-left cursor-pointer px-4 py-2 border"
                    onClick={() => {
                      setSortField("companyName");
                      setSortOrder(
                        sortField === "companyName" && sortOrder === "asc"
                          ? "desc"
                          : "asc"
                      );
                    }}
                  >
                    <div className="flex justify-center items-center gap-2">
                      <span>Name</span>
                      <i
                        className={`fa ${
                          sortField === "companyName"
                            ? sortOrder === "asc"
                              ? "fa-sort-up"
                              : "fa-sort-down"
                            : "fa-sort"
                        }`}
                      />
                    </div>
                  </th>
                  <th className="text-left px-4 py-2 border">Address</th>
                  <th 
                    className="text-left cursor-pointer px-4 py-2 border"
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
                  <th className="text-left px-4 py-2 border">By</th>
                  <th 
                    className="text-left cursor-pointer px-4 py-2 border"
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
                  <th className="text-left px-4 py-2 border">By</th>
                </tr>
              </thead>
              <tbody className='text-sm'>
                {list.map((Vendor, index) => (
                  <tr key={Vendor._id}>
                    <td className="px-4 py-2 border-t border-t-black text-center">{(currentPage - 1) * pageSize + index + 1}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.picName}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.picContact}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.companyName}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.companyAddress}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.createdDate}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.createdBy?.name}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.updatedDate || '-'}</td>
                    <td className="px-4 py-2 border-t border-t-black">{Vendor.updatedBy?.name || '-'}</td>
                    <td className="px-4 py-2 border-t border-t-black text-nowrap">
                      <button
                        type="button"
                        onClick={() => handleEdit(Vendor)}
                        className="bg-yellow-600 hover:bg-yellow-700 cursor-pointer text-white w-8 h-8 mr-2 rounded"
                      >
                        <i className='fa fa-pen'></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(Vendor._id)}
                        className="bg-red-600 hover:bg-red-700 cursor-pointer text-white h-8 w-8 rounded"
                      >
                        <i className='fa fa-trash'></i>
                      </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan="10" className="text-center py-4 text-gray-500">
                      Data Vendor is Empty
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
