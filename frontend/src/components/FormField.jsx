import { labelClass } from '../utils/formStyles';

/** Label + input (children) + teks bantuan opsional untuk form di drawer. */
export default function FormField({ label, htmlFor, hint, required = false, children }) {
  return (
    <div>
      <label className={labelClass} htmlFor={htmlFor}>
        {label}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}
