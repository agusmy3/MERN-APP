import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';

export default function MainLayout({ children }) {
  return (
    <div className='h-screen flex flex-col overflow-hidden'>
      <Navbar />
      <div className='flex flex-1 overflow-hidden'>
        <Sidebar />
        <main className='w-4/5 flex-1 min-h-0 overflow-hidden'>
          {children}
        </main>
      </div>
    </div>
  );
}
