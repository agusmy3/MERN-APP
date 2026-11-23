import { Link } from 'react-router-dom';
import { MOVEMENT_TYPES } from '../../utils/stockMeta';

/** Link ke dokumen sumber pergerakan stok */
export function MovementRef({ m }) {
  if (!m.refNo) return <span className="text-muted">-</span>;
  if (m.refType === 'StockAdjustment' && m.refId) {
    return (
      <Link to={`/stock-adjustment/${m.refId}`} className="font-mono text-xs font-semibold text-primary hover:underline">
        {m.refNo}
      </Link>
    );
  }
  if (m.refType === 'GoodsReceipt' && m.refId) {
    return (
      <Link to={`/goods-receipt/${m.refId}`} className="font-mono text-xs font-semibold text-primary hover:underline">
        {m.refNo}
      </Link>
    );
  }
  return <span className="font-mono text-xs">{m.refNo}</span>;
}

export function MovementType({ m }) {
  return (
    <span className="text-muted">
      {MOVEMENT_TYPES[m.type] || m.type}
      {m.isReversal && (
        <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-danger-soft text-danger" title="Pembalik dari pembatalan dokumen">
          reversal
        </span>
      )}
    </span>
  );
}
