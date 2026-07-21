import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  interval,
  scan,
  switchMap,
  map,
  shareReplay,
  tap,
  startWith,
  distinctUntilChanged,
  filter,
  withLatestFrom,
  take,
} from 'rxjs';

import { Candle, MarketSnapshot, OrderBook, OHLCV, Ticker, Trade } from '../models/market.model';

interface SimulatedAsset {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  basePrice: number;
  volatility: number;
  volumeBase: number;
}

interface PriceState {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

@Injectable({ providedIn: 'root' })
export class MarketService implements OnDestroy {
  private readonly TICK_INTERVAL_MS = 1000;
  private readonly CANDLE_INTERVAL_MS = 5000;
  private readonly MAX_TRADES = 50;
  private readonly MAX_CANDLES = 120;
  private readonly ORDERBOOK_DEPTH = 15;

  private readonly subscriptions = new Subscription();
  private readonly destroy$ = new Subject<void>();

  private readonly ASSETS: SimulatedAsset[] = [
    { symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', basePrice: 67450.00, volatility: 0.0012, volumeBase: 12800 },
    { symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', basePrice: 3520.00, volatility: 0.0018, volumeBase: 85000 },
    { symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', basePrice: 178.50, volatility: 0.0035, volumeBase: 420000 },
    { symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', basePrice: 605.00, volatility: 0.0015, volumeBase: 32000 },
    { symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', basePrice: 0.6280, volatility: 0.0025, volumeBase: 8500000 },
    { symbol: 'ADA/USDT', baseAsset: 'ADA', quoteAsset: 'USDT', basePrice: 0.4850, volatility: 0.0030, volumeBase: 5200000 },
    { symbol: 'AVAX/USDT', baseAsset: 'AVAX', quoteAsset: 'USDT', basePrice: 42.30, volatility: 0.0028, volumeBase: 180000 },
    { symbol: 'DOGE/USDT', baseAsset: 'DOGE', quoteAsset: 'USDT', basePrice: 0.1580, volatility: 0.0040, volumeBase: 12000000 },
  ];

  private readonly priceStates = new Map<string, PriceState>();
  private readonly tickerSubjects = new Map<string, BehaviorSubject<Ticker>>();
  private readonly candleHistory = new Map<string, Candle[]>();
  private readonly orderBookSubject = new BehaviorSubject<OrderBook | null>(null);
  private readonly tradesSubject = new BehaviorSubject<Trade[]>([]);
  private readonly selectedSymbolSubject = new BehaviorSubject<string>('BTC/USDT');

  readonly tickers$: Observable<Ticker[]>;
  readonly orderBook$ = this.orderBookSubject.asObservable();
  readonly recentTrades$ = this.tradesSubject.asObservable();
  readonly selectedSymbol$ = this.selectedSymbolSubject.asObservable();
  readonly snapshot$: Observable<MarketSnapshot>;

  constructor() {
    this.initializeStates();
    this.tickers$ = this.buildTickersStream();
    this.snapshot$ = this.buildSnapshotStream();
    this.startSimulation();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subscriptions.unsubscribe();
  }

  selectSymbol(symbol: string): void {
    this.selectedSymbolSubject.next(symbol);
  }

  getTickerBySymbol$(symbol: string): Observable<Ticker> | undefined {
    return this.tickerSubjects.get(symbol)?.asObservable();
  }

  getCurrentPrice(symbol: string): number {
    return this.tickerSubjects.get(symbol)?.value.price ?? 0;
  }

  getAvailableSymbols(): string[] {
    return this.ASSETS.map(a => a.symbol);
  }

  getCandleHistory(symbol: string): Candle[] {
    return [...(this.candleHistory.get(symbol) ?? [])];
  }

  private initializeStates(): void {
    for (const asset of this.ASSETS) {
      const jitter = (Math.random() - 0.5) * asset.basePrice * 0.002;
      const currentPrice = asset.basePrice + jitter;

      this.priceStates.set(asset.symbol, {
        price: currentPrice,
        open24h: asset.basePrice,
        high24h: currentPrice * 1.008,
        low24h: currentPrice * 0.992,
        volume24h: asset.volumeBase * (0.8 + Math.random() * 0.4),
        quoteVolume24h: asset.volumeBase * asset.basePrice * (0.8 + Math.random() * 0.4),
      });

      this.tickerSubjects.set(
        asset.symbol,
        new BehaviorSubject<Ticker>(this.buildTicker(asset.symbol))
      );

      this.candleHistory.set(asset.symbol, this.generateInitialCandles(asset));
    }
  }

  private generateInitialCandles(asset: SimulatedAsset): Candle[] {
    const candles: Candle[] = [];
    const now = Date.now();
    let rollingPrice = asset.basePrice * (0.97 + Math.random() * 0.03);

    for (let i = this.MAX_CANDLES; i > 0; i--) {
      const timestamp = now - i * this.CANDLE_INTERVAL_MS;
      const volatility = asset.volatility * (0.5 + Math.random());

      const open = rollingPrice;
      const change = open * volatility * (Math.random() - 0.48);
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(change) * Math.random() * 0.5;
      const low = Math.min(open, close) - Math.abs(change) * Math.random() * 0.5;
      const volume = asset.volumeBase * (0.001 + Math.random() * 0.003);

      candles.push({
        timestamp,
        open: this.roundPrice(open, asset.symbol),
        high: this.roundPrice(high, asset.symbol),
        low: this.roundPrice(low, asset.symbol),
        close: this.roundPrice(close, asset.symbol),
        volume,
        index: i,
        isClosed: true,
      });

      rollingPrice = close;
    }

    const lastCandle = candles[candles.length - 1];
    const state = this.priceStates.get(asset.symbol)!;
    state.price = lastCandle.close;

    return candles;
  }

  private buildTickersStream(): Observable<Ticker[]> {
    return interval(this.TICK_INTERVAL_MS).pipe(
      switchMap(() => {
        const tickers: Ticker[] = [];
        for (const asset of this.ASSETS) {
          tickers.push(this.tickPrice(asset));
        }
        return [tickers];
      }),
      startWith(this.ASSETS.map(a => this.buildTicker(a.symbol))),
      shareReplay(1)
    );
  }

  private buildSnapshotStream(): Observable<MarketSnapshot> {
    return interval(this.TICK_INTERVAL_MS).pipe(
      withLatestFrom(this.tickers$, this.recentTrades$),
      map(([_, tickers, trades]) => ({
        tickers,
        orderBook: this.orderBookSubject.value ?? this.buildOrderBook(this.ASSETS[0].symbol),
        recentTrades: trades,
        candles: this.candleHistory.get(this.selectedSymbolSubject.value) ?? [],
        timestamp: Date.now(),
      })),
      shareReplay(1)
    );
  }

  private tickPrice(asset: SimulatedAsset): Ticker {
    const state = this.priceStates.get(asset.symbol)!;

    const drift = (Math.random() - 0.498) * asset.volatility;
    const momentum = (state.price - state.open24h) / state.open24h * 0.05;
    const noise = (Math.random() - 0.5) * asset.volatility * 0.3;
    const changePercent = drift + momentum + noise;

    const newPrice = Math.max(state.price * (1 + changePercent), asset.basePrice * 0.5);
    state.price = this.roundPrice(newPrice, asset.symbol);
    state.high24h = Math.max(state.high24h, state.price);
    state.low24h = Math.min(state.low24h, state.price);

    const volumeTick = asset.volumeBase * (0.0001 + Math.random() * 0.0005);
    state.volume24h += volumeTick;
    state.quoteVolume24h += volumeTick * state.price;

    const ticker: Ticker = {
      symbol: asset.symbol,
      baseAsset: asset.baseAsset,
      quoteAsset: asset.quoteAsset,
      price: state.price,
      change24h: this.roundPrice(state.price - state.open24h, asset.symbol),
      changePercent24h: parseFloat(((state.price - state.open24h) / state.open24h * 100).toFixed(2)),
      high24h: this.roundPrice(state.high24h, asset.symbol),
      low24h: this.roundPrice(state.low24h, asset.symbol),
      volume24h: parseFloat(state.volume24h.toFixed(4)),
      quoteVolume24h: parseFloat(state.quoteVolume24h.toFixed(2)),
      lastUpdate: Date.now(),
    };

    this.tickerSubjects.get(asset.symbol)?.next(ticker);
    this.updateCurrentCandle(asset, state.price, volumeTick);
    this.generateTrade(asset, state.price);
    this.regenerateOrderBook(asset.symbol, state.price);

    return ticker;
  }

  private updateCurrentCandle(asset: SimulatedAsset, price: number, volume: number): void {
    const candles = this.candleHistory.get(asset.symbol)!;
    const lastCandle = candles[candles.length - 1];

    if (Date.now() - lastCandle.timestamp >= this.CANDLE_INTERVAL_MS) {
      const newCandle: Candle = {
        timestamp: Date.now(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        index: lastCandle.index + 1,
        isClosed: false,
      };

      candles.push(newCandle);

      if (candles.length > this.MAX_CANDLES) {
        candles.shift();
      }
    } else {
      lastCandle.high = Math.max(lastCandle.high, price);
      lastCandle.low = Math.min(lastCandle.low, price);
      lastCandle.close = price;
      lastCandle.volume += volume;
    }
  }

  private generateTrade(asset: SimulatedAsset, price: number): void {
    const trades = [...this.tradesSubject.value];
    const side: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell';
    const qty = parseFloat((Math.random() * asset.volumeBase * 0.00005).toFixed(6));

    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: asset.symbol,
      price: this.roundPrice(price + (Math.random() - 0.5) * price * asset.volatility * 0.1, asset.symbol),
      quantity: qty,
      side,
      timestamp: Date.now(),
    };

    trades.unshift(trade);
    if (trades.length > this.MAX_TRADES) {
      trades.pop();
    }
    this.tradesSubject.next(trades);
  }

  private regenerateOrderBook(symbol: string, midPrice: number): void {
    const asset = this.ASSETS.find(a => a.symbol === symbol);
    if (!asset) return;

    const tickSize = this.getTickSize(midPrice);
    const bids: OrderBook['bids'] = [];
    const asks: OrderBook['asks'] = [];

    let bidTotal = 0;
    let askTotal = 0;

    for (let i = 0; i < this.ORDERBOOK_DEPTH; i++) {
      const spreadBase = tickSize * (1 + i * 0.6);
      const bidPrice = this.roundPrice(midPrice - spreadBase - Math.random() * tickSize * 0.3, symbol);
      const askPrice = this.roundPrice(midPrice + spreadBase + Math.random() * tickSize * 0.3, symbol);

      const bidQty = parseFloat((Math.random() * asset.volumeBase * 0.0003 * (1 + i * 0.2)).toFixed(6));
      const askQty = parseFloat((Math.random() * asset.volumeBase * 0.0003 * (1 + i * 0.2)).toFixed(6));

      bidTotal += bidQty;
      askTotal += askQty;

      bids.push({ price: bidPrice, quantity: bidQty, total: parseFloat(bidTotal.toFixed(6)) });
      asks.push({ price: askPrice, quantity: askQty, total: parseFloat(askTotal.toFixed(6)) });
    }

    const bestBid = bids[0]?.price ?? midPrice;
    const bestAsk = asks[0]?.price ?? midPrice;
    const spread = parseFloat((bestAsk - bestBid).toFixed(8));

    this.orderBookSubject.next({
      symbol,
      bids,
      asks,
      spread,
      spreadPercent: parseFloat(((spread / midPrice) * 100).toFixed(4)),
      lastUpdate: Date.now(),
    });
  }

  private buildTicker(symbol: string): Ticker {
    const asset = this.ASSETS.find(a => a.symbol === symbol)!;
    const state = this.priceStates.get(symbol)!;

    return {
      symbol,
      baseAsset: asset.baseAsset,
      quoteAsset: asset.quoteAsset,
      price: state.price,
      change24h: this.roundPrice(state.price - state.open24h, symbol),
      changePercent24h: parseFloat(((state.price - state.open24h) / state.open24h * 100).toFixed(2)),
      high24h: this.roundPrice(state.high24h, symbol),
      low24h: this.roundPrice(state.low24h, symbol),
      volume24h: parseFloat(state.volume24h.toFixed(4)),
      quoteVolume24h: parseFloat(state.quoteVolume24h.toFixed(2)),
      lastUpdate: Date.now(),
    };
  }

  private buildOrderBook(symbol: string): OrderBook {
    const asset = this.ASSETS.find(a => a.symbol === symbol);
    if (!asset) {
      return { symbol, bids: [], asks: [], spread: 0, spreadPercent: 0, lastUpdate: Date.now() };
    }
    this.regenerateOrderBook(symbol, asset.basePrice);
    return this.orderBookSubject.value!;
  }

  private roundPrice(price: number, symbol: string): number {
    if (price >= 1000) return parseFloat(price.toFixed(2));
    if (price >= 1) return parseFloat(price.toFixed(4));
    if (price >= 0.01) return parseFloat(price.toFixed(6));
    return parseFloat(price.toFixed(8));
  }

  private getTickSize(price: number): number {
    if (price >= 10000) return 0.01;
    if (price >= 1000) return 0.1;
    if (price >= 100) return 0.01;
    if (price >= 10) return 0.001;
    if (price >= 1) return 0.0001;
    return 0.00001;
  }

  private startSimulation(): void {
    this.regenerateOrderBook(this.ASSETS[0].symbol, this.ASSETS[0].basePrice);
  }
}
