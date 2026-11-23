import { useState } from 'react';
import { inputClass } from '../utils/formStyles';

/**
 * Input daftar nilai berbentuk chip. Nilai ditambahkan dengan Enter, koma, atau saat
 * input kehilangan fokus (jadi teks yang belum di-Enter tetap ikut saat klik Save).
 * Duplikat (tanpa membedakan huruf besar/kecil) dan nilai kosong diabaikan.
 */
export default function TagInput({ id, value, onChange, placeholder }) {
  const [input, setInput] = useState('');

  const commit = (raw) => {
    const next = [...value];
    raw.split(',').map((v) => v.trim()).forEach((v) => {
      if (v && !next.some((x) => x.toLowerCase() === v.toLowerCase())) {
        next.push(v);
      }
    });
    if (next.length !== value.length) onChange(next);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault(); // jangan submit form / mengetik koma
      if (input.trim()) commit(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((v, i) => (
            <span key={v} className="inline-flex items-center gap-1 bg-primary-soft text-primary-soft-fg text-sm px-2 py-1 rounded">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                className="cursor-pointer text-primary hover:text-danger"
              >
                <i className="fa fa-xmark text-xs"></i>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => input.trim() && commit(input)}
        className={inputClass}
      />
    </div>
  );
}
