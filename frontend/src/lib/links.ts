/** Maps Backend resource/source types to Frontend routes (detail views open via ?id= on list pages). */
export function resourceHref(type: string, id: string): string | null {
  switch (type) {
    case 'Product':
      return `/inventory/${id}`;
    case 'Customer':
      return `/customers/${id}`;
    case 'Order':
      return `/orders/${id}`;
    case 'StockIn':
      return `/stock-in?id=${id}`;
    case 'StockOut':
    case 'Transfer':
      return `/stock-out?id=${id}`;
    case 'Return':
      return `/returns?id=${id}`;
    case 'Adjustment':
      return `/adjustments?id=${id}`;
    case 'DamagedStockAction':
      return `/damaged-stock?id=${id}`;
    case 'Receipt':
      return `/search?receipt=${id}`;
    default:
      return null;
  }
}
