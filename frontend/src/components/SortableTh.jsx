export default function SortableTh({ field, label, sortField, sortOrder, onSort, className = '', ...props }) {
  const active = sortField === field;
  let icon = 'fa-sort';
  if (active) icon = sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down';

  return (
    <th
      {...props}
      className={`h-11 px-4 py-0 border-b border-line font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-subtle ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-2">
        <span className="truncate">{label}</span>
        <i className={`fa ${icon} ${active ? 'text-primary' : 'opacity-40'}`} />
      </div>
    </th>
  );
}
