// Daftar palet tampilan. `id` harus sama dengan selector [data-theme="..."] di src/index.css.
// Backend hanya memeriksa format id (lihat THEME_ID di backend/controllers/authController.js);
// id yang tidak ada di daftar ini kembali ke DEFAULT_THEME di frontend.
export const THEMES = [
  {
    id: 'slate-indigo',
    name: 'Slate & Indigo',
    tag: 'Modern, tenang, profesional',
    description: 'Mayoritas netral dengan indigo hanya untuk aksi utama. Nyaman dipakai berjam-jam.',
  },
  {
    id: 'navy-amber',
    name: 'Navy & Amber',
    tag: 'Korporat, tegas, khas ERP',
    description: 'Bingkai navy yang menyatu dengan aksen amber untuk penanda menu aktif.',
  },
  {
    id: 'emerald-stone',
    name: 'Emerald & Stone',
    tag: 'Segar dan hangat',
    description: 'Hijau gelap dipadu netral hangat. Cocok untuk konteks stok dan produk.',
  },
  {
    id: 'light-teal',
    name: 'Light & Teal',
    tag: 'Minimalis dan terang',
    description: 'Sidebar ikut terang, menu aktif ditandai teal muda. Paling lapang.',
  },
  {
    id: 'zinc-sky',
    name: 'Zinc & Sky',
    tag: 'Mode gelap',
    description: 'Latar gelap dengan aksen biru langit. Nyaman untuk ruangan redup.',
    dark: true,
  },
  {
    id: 'ocean-coral',
    name: 'Ocean & Coral',
    tag: 'Segar dan cerah',
    description: 'Sidebar biru laut dengan penanda menu coral. Bersih dan modern.',
  },
  {
    id: 'violet-sunset',
    name: 'Violet & Sunset',
    tag: 'Paling berwarna',
    description: 'Navbar dan sidebar ungu dengan aksen oranye senja. Bingkai aplikasi paling hidup.',
  },
  {
    id: 'tropical-teal',
    name: 'Tropical Teal',
    tag: 'Ceria tapi tenang',
    description: 'Teal tua dengan aksen kuning lemon. Berwarna tanpa melelahkan mata.',
  },
  {
    id: 'berry-sky',
    name: 'Berry & Sky',
    tag: 'Berani dan unik',
    description: 'Sidebar berry tua, tombol magenta, penanda menu biru langit.',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tag: 'Mode gelap berwarna',
    description: 'Latar biru malam dengan aksen ungu terang dan hijau aurora.',
    dark: true,
  },
];

export const DEFAULT_THEME = 'slate-indigo';
export const THEME_STORAGE_KEY = 'theme';

export const isValidTheme = (id) => THEMES.some((t) => t.id === id);
