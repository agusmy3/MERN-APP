// Daftar palet tampilan. `id` harus sama dengan selector [data-theme="..."] di src/index.css
// dan ALLOWED_THEMES di backend/controllers/authController.js.
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
];

export const DEFAULT_THEME = 'slate-indigo';
export const THEME_STORAGE_KEY = 'theme';

export const isValidTheme = (id) => THEMES.some((t) => t.id === id);
