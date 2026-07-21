import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  combineLatest,
  map,
  shareReplay,
  tap,
} from 'rxjs';

import { AssetBalance, PortfolioSummary } from '../models/portfolio.model';
import { Ticker } from '../models/market.model';
import { MarketService } from './market.service';

interface Holding {
  asset: string;
  free: number;
  locked: number;
  avgEntryPrice: number;
}

interface HoldingUpdate {
  asset: string;
  quantity: number;
  side: 'buy' | 'sell';
  executionPrice: number;
}

@Injectable({ providedIn: 'root' })
export class PortfolioService implements OnDestroy {
  private readonly INITIAL_BALANCE_USDT = 10000;
  private readonly subscriptions = new Subscription();
  private readonly destroy$ = new Subject<void>();

  private readonly holdings = new Map<string, Holding>();
  private readonly holdingsSubject = new BehaviorSubject<Map<string, Holding>>(new Map());
  private readonly portfolioSubject = new BehaviorSubject<PortfolioSummary | null>(null);

  readonly portfolio$ = this.portfolioSubject.asObservable();
  readonly holdings$ = this.holdingsSubject.asObservable();

  constructor(private readonly marketService: MarketService) {
    this.initializeBalance();
    this.startPnLRecalculation();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subscriptions.unsubscribe();
  }

  getBalance(asset: string): Holding {
    return this.holdings.get(asset) ?? { asset, free: 0, locked: 0, avgEntryPrice: 0 };
  }

  getFreeBalance(asset: string): number {
    return this.getBalance(asset).free;
  }

  canAfford(costUsd: number): boolean {
    const usdt = this.getBalance('USDT');
    return usdt.free >= costUsd;
  }

  lockFunds(asset: string, quantity: number): boolean {
    const holding = this.holdings.get(asset);
    if (!holding || holding.free < quantity) {
      return false;
    }

    holding.free = parseFloat((holding.free - quantity).toFixed(8));
    holding.locked = parseFloat((holding.locked + quantity).toFixed(8));
    this.emitUpdates();
    return true;
  }

  unlockFunds(asset: string, quantity: number): void {
    const holding = this.holdings.get(asset);
    if (!holding) return;

    holding.free = parseFloat((holding.free + quantity).toFixed(8));
    holding.locked = parseFloat((holding.locked - quantity).toFixed(8));
    this.emitUpdates();
  }

  processFilling(update: HoldingUpdate): void {
    if (update.side === 'buy') {
      this.processBuyFill(update);
    } else {
      this.processSellFill(update);
    }
    this.emitUpdates();
  }

  private processBuyFill(update: HoldingUpdate): void {
    const holding = this.holdings.get(update.asset) ?? this.createHolding(update.asset);

    const costUsd = update.quantity * update.executionPrice;
    const usdtHolding = this.holdings.get('USDT')!;
    usdtHolding.free = parseFloat((usdtHolding.free - costUsd).toFixed(2));

    const totalQtyBefore = holding.free + holding.locked;
    const totalCostBefore = totalQtyBefore * holding.avgEntryPrice;
    const newTotalQty = totalQtyBefore + update.quantity;
    const newTotalCost = totalCostBefore + costUsd;

    holding.avgEntryPrice = newTotalQty > 0
      ? parseFloat((newTotalCost / newTotalQty).toFixed(8))
      : 0;
    holding.locked = parseFloat((holding.locked - update.quantity).toFixed(8));
    holding.free = parseFloat((holding.free + update.quantity).toFixed(8));
  }

  private processSellFill(update: HoldingUpdate): void {
    const holding = this.holdings.get(update.asset);
    if (!holding) return;

    const proceedsUsd = update.quantity * update.executionPrice;
    const usdtHolding = this.holdings.get('USDT')!;
    usdtHolding.free = parseFloat((usdtHolding.free + proceedsUsd).toFixed(2));

    holding.locked = parseFloat((holding.locked - update.quantity).toFixed(8));

    const remainingTotal = holding.free + holding.locked;
    if (remainingTotal <= 0.00000001) {
      holding.free = 0;
      holding.locked = 0;
      holding.avgEntryPrice = 0;
    }
  }

  private initializeBalance(): void {
    this.holdings.set('USDT', {
      asset: 'USDT',
      free: this.INITIAL_BALANCE_USDT,
      locked: 0,
      avgEntryPrice: 1,
    });
    this.holdingsSubject.next(new Map(this.holdings));
  }

  private startPnLRecalculation(): void {
    const sub = this.marketService.tickers$.pipe(
      tap(tickers => this.recalculatePortfolio(tickers))
    ).subscribe();

    this.subscriptions.add(sub);
  }

  private recalculatePortfolio(tickers: Ticker[]): void {
    const tickerMap = new Map<string, Ticker>();
    for (const t of tickers) {
      tickerMap.set(t.baseAsset, t);
    }

    const assets: AssetBalance[] = [];
    let totalUsdValue = 0;
    let totalCostBasis = 0;

    for (const [asset, holding] of this.holdings) {
      const totalQty = holding.free + holding.locked;
      const ticker = tickerMap.get(asset);

      if (asset === 'USDT') {
        const usdValue = totalQty;
        totalUsdValue += usdValue;
        totalCostBasis += totalQty;

        assets.push({
          asset: 'USDT',
          free: holding.free,
          locked: holding.locked,
          total: totalQty,
          usdValue,
          pnl24h: 0,
          pnlPercent24h: 0,
        });
        continue;
      }

      if (!ticker || totalQty <= 0) continue;

      const currentUsdValue = totalQty * ticker.price;
      const costBasis = totalQty * holding.avgEntryPrice;
      const pnl = currentUsdValue - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

      totalUsdValue += currentUsdValue;
      totalCostBasis += costBasis;

      assets.push({
        asset,
        free: holding.free,
        locked: holding.locked,
        total: totalQty,
        usdValue: parseFloat(currentUsdValue.toFixed(2)),
        pnl24h: parseFloat(pnl.toFixed(2)),
        pnlPercent24h: parseFloat(pnlPercent.toFixed(2)),
      });
    }

    const totalPnl24h = totalUsdValue - this.INITIAL_BALANCE_USDT;
    const totalPnlPercent = this.INITIAL_BALANCE_USDT > 0
      ? (totalPnl24h / this.INITIAL_BALANCE_USDT) * 100
      : 0;

    const summary: PortfolioSummary = {
      totalUsdValue: parseFloat(totalUsdValue.toFixed(2)),
      totalPnl24h: parseFloat(totalPnl24h.toFixed(2)),
      totalPnlPercent24h: parseFloat(totalPnlPercent.toFixed(2)),
      assets: assets.sort((a, b) => b.usdValue - a.usdValue),
      lastUpdate: Date.now(),
    };

    this.portfolioSubject.next(summary);
  }

  private createHolding(asset: string): Holding {
    const holding: Holding = { asset, free: 0, locked: 0, avgEntryPrice: 0 };
    this.holdings.set(asset, holding);
    return holding;
  }

  private emitUpdates(): void {
    this.holdingsSubject.next(new Map(this.holdings));
  }
}
