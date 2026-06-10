import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Kategori from './pages/Kategori';
import Produk from './pages/Produk';
import Menu from './pages/Menu';
import MainLayout from './layouts/MainLayout';
import { useAuth } from './context/AuthContext';

function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
      
      <Route path="/" element={user ? <MainLayout><Dashboard /></MainLayout> : <Navigate to="/login" />} />
      <Route path="/kategori" element={user ? <MainLayout><Kategori /></MainLayout> : <Navigate to="/login" />} />
      <Route path="/produk" element={user ? <MainLayout><Produk /></MainLayout> : <Navigate to="/login" />} />
      <Route path="/menu" element={user ? <MainLayout><Menu /></MainLayout> : <Navigate to="/login" />} />
    </Routes>
  );
}

export default App
