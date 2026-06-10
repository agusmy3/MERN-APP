import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  const linkStyle = {
    marginRight: 10,
    cursor: 'pointer',
    color: 'white',
    textDecoration: 'none',
    border: 'none',
    background: 'none',
    padding: 0,
    fontSize: 'inherit',
  };
  
  return (
    // <nav style={{ borderBottom: '1px solid #ccc', padding: '1rem' }}>
    //   <Link to="/" style={linkStyle}>🏠 Home</Link>
    //   <Link to="/produk" style={linkStyle}>📦 Produk</Link>
    //   <Link to="/kategori" style={linkStyle}>📁 Kategori</Link>
    //   <button onClick={handleLogout} style={linkStyle}>🚪 Logout</button>
    // </nav>
    <nav className="sticky top-0 bg-blue-600 text-white px-6 py-3 flex flex-row justify-between items-center shadow-md">
      <div className="flex space-x-4">
        {/* <Link to="/" className="hover:text-blue-200 font-semibold">Home</Link>
        <Link to="/produk" className="hover:text-blue-200 font-semibold">Produk</Link>
        <Link to="/kategori" className="hover:text-blue-200 font-semibold">Kategori</Link>
        <Link to="/menu" className="hover:text-blue-200 font-semibold">Menu</Link> */}
      </div>
      <button
        onClick={handleLogout}
        className="bg-red-500 hover:bg-red-600 px-4 py-1 rounded text-sm font-medium"
      >
        Logout
      </button>
    </nav>
  );
}
