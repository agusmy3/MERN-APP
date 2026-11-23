import { useState } from 'react';
import PageHeader from '../components/PageHeader';
import useTheme from '../hooks/useTheme';
import useToast from '../hooks/useToast';
import { THEMES, DEFAULT_THEME } from '../theme/themes';

/**
 * Miniatur aplikasi. Dibungkus data-theme milik palet itu sendiri, jadi warnanya
 * berasal dari token tema yang sama dengan aplikasi asli (bukan gambar statis).
 */
function ThemePreview({ themeId }) {
  return (
    <div
      data-theme={themeId}
      aria-hidden="true"
      className="h-36 flex flex-col overflow-hidden rounded-md border border-line bg-page text-fg"
    >
      <div className="h-6 shrink-0 flex items-center gap-1.5 px-2 bg-nav border-b border-nav-line">
        <span className="w-2.5 h-1 rounded-full bg-nav-fg/70"></span>
        <span className="w-10 h-1.5 rounded-full bg-nav-fg/60"></span>
        <span className="ml-auto w-3.5 h-3.5 rounded-full bg-primary-soft"></span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-14 shrink-0 bg-side p-1.5 space-y-1.5 border-r border-side-line">
          <div className="h-1.5 w-8 rounded-full bg-side-fg/40"></div>
          <div className="relative h-3 rounded bg-side-active">
            <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 rounded-full bg-side-bar"></span>
          </div>
          <div className="h-1.5 w-9 rounded-full bg-side-fg/40"></div>
          <div className="h-1.5 w-7 rounded-full bg-side-fg/40"></div>
        </div>
        <div className="flex-1 min-w-0 p-2 space-y-1.5">
          <div className="h-2 w-20 rounded-full bg-fg/70"></div>
          <div className="rounded border border-line bg-surface p-1.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="h-2.5 w-14 rounded-sm border border-line bg-input"></div>
              <div className="h-2.5 w-8 rounded-sm bg-primary"></div>
            </div>
            <div className="h-2.5 rounded-sm bg-head border border-line"></div>
            <div className="h-2 rounded-sm bg-line-soft"></div>
            <div className="h-2 rounded-sm bg-highlight"></div>
            <div className="h-2 rounded-sm bg-line-soft"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Appearance() {
  const { theme, setTheme } = useTheme();
  const [savingId, setSavingId] = useState(null);
  const toast = useToast();

  const choose = async (id) => {
    if (id === theme || savingId) return;
    setSavingId(id);
    try {
      await setTheme(id);
      toast.success(`Theme changed to ${THEMES.find((t) => t.id === id).name}`);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save theme. Please try again.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader fallbackTitle="Appearance" />

      <div className="p-4 bg-surface border border-line rounded-lg shadow-sm">
        <p className="text-sm text-muted mb-4">
          Pilih palet tampilan. Perubahan langsung berlaku dan tersimpan di akun Anda,
          jadi ikut terbawa saat login dari perangkat lain.
        </p>

        <div role="radiogroup" aria-label="Theme" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((t) => {
            const active = t.id === theme;
            const saving = t.id === savingId;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(t.id)}
                disabled={!!savingId}
                className={`text-left p-3 rounded-lg border bg-surface cursor-pointer transition
                  focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2
                  disabled:cursor-wait
                  ${active ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-muted'}`}
              >
                <ThemePreview themeId={t.id} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-fg flex items-center gap-2">
                      {t.name}
                      {t.dark && <i className="fa fa-moon text-xs text-muted" title="Dark theme"></i>}
                    </div>
                    <div className="text-xs text-muted">{t.tag}</div>
                  </div>
                  <div className="shrink-0 flex gap-1">
                    {t.id === DEFAULT_THEME && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-line text-muted">Default</span>
                    )}
                    {active && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary text-primary-fg font-semibold">
                        <i className="fa fa-check mr-1"></i>Active
                      </span>
                    )}
                    {saving && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-subtle text-muted">Saving...</span>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted">{t.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
