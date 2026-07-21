export interface AssetBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdValue: number;
  pnl24h: number;
  pnlPercent24h: number;
}

export interface PortfolioSummary {
  totalUsdValue: number;
  totalPnl24h: number;
  totalPnlPercent24h: number;
  assets: AssetBalance[];
  lastUpdate: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop_limit';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'partial' | 'cancelled';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity: number;
  filled: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlaceOrderPayload {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity: number;
}
