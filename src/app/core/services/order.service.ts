import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  concatMap,
  delay,
  filter,
  map,
  mergeMap,
  of,
  shareReplay,
  switchMap,
  take,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';

import { Order, OrderStatus, PlaceOrderPayload } from '../models/portfolio.model';
import { MarketService } from './market.service';
import { PortfolioService } from './portfolio.service';

interface PendingOrder extends Order {
  intervalCleanup$?: Subscription;
}

@Injectable({ providedIn: 'root' })
export class OrderService implements OnDestroy {
  private readonly MAX_ORDER_HISTORY = 100;
  private readonly EXECUTION_DELAY_MS = 300;

  private readonly destroy$ = new Subject<void>();
  private readonly orderQueue$ = new Subject<PendingOrder>();

  private readonly activeOrdersSubject = new BehaviorSubject<PendingOrder[]>([]);
  private readonly orderHistorySubject = new BehaviorSubject<Order[]>([]);

  readonly activeOrders$ = this.activeOrdersSubject.asObservable();
  readonly orderHistory$ = this.orderHistorySubject.asObservable();

  constructor(
    private readonly marketService: MarketService,
    private readonly portfolioService: PortfolioService,
  ) {
    this.startOrderProcessor();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cancelAllActiveOrders();
  }

  placeOrder(payload: PlaceOrderPayload): Order | null {
    const validation = this.validateOrder(payload);
    if (!validation.valid) {
      return null;
    }

    const order: PendingOrder = {
      id: this.generateOrderId(),
      symbol: payload.symbol,
      side: payload.side,
      type: payload.type,
      price: payload.price,
      quantity: payload.quantity,
      filled: 0,
      status: payload.type === 'market' ? 'pending' : 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.reserveFunds(order);

    if (order.type === 'market') {
      this.executeMarketOrder(order);
    } else {
      this.monitorLimitOrder(order);
    }

    return order;
  }

  cancelOrder(orderId: string): boolean {
    const activeOrders = this.activeOrdersSubject.value;
    const orderIndex = activeOrders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return false;

    const order = activeOrders[orderIndex];
    if (order.status !== 'open') return false;

    order.status = 'cancelled';
    order.updatedAt = Date.now();
    this.releaseFunds(order);
    this.moveToHistory(order);
    this.removeActiveOrder(orderId);
    return true;
  }

  cancelAllActiveOrders(): void {
    const activeOrders = [...this.activeOrdersSubject.value];
    for (const order of activeOrders) {
      if (order.status === 'open') {
        this.cancelOrder(order.id);
      }
    }
  }

  private validateOrder(payload: PlaceOrderPayload): { valid: boolean; reason?: string } {
    if (payload.quantity <= 0) {
      return { valid: false, reason: 'Quantity must be positive' };
    }

    if (payload.price < 0) {
      return { valid: false, reason: 'Price cannot be negative' };
    }

    if (payload.type === 'market' && payload.price > 0) {
      return { valid: false, reason: 'Market orders use current price, not a fixed price' };
    }

    const currentPrice = this.marketService.getCurrentPrice(payload.symbol);
    if (currentPrice <= 0) {
      return { valid: false, reason: 'Market data unavailable' };
    }

    const executionPrice = payload.type === 'market' ? currentPrice : payload.price;
    const costUsd = payload.quantity * executionPrice;

    if (payload.side === 'buy') {
      if (!this.portfolioService.canAfford(costUsd)) {
        return { valid: false, reason: 'Insufficient USDT balance' };
      }
    } else {
      const baseAsset = payload.symbol.split('/')[0];
      const available = this.portfolioService.getFreeBalance(baseAsset);
      if (available < payload.quantity) {
        return { valid: false, reason: `Insufficient ${baseAsset} balance` };
      }
    }

    return { valid: true };
  }

  private reserveFunds(order: PendingOrder): void {
    const baseAsset = order.symbol.split('/')[0];

    if (order.side === 'buy') {
      const executionPrice = order.type === 'market'
        ? this.marketService.getCurrentPrice(order.symbol)
        : order.price;
      const costUsd = order.quantity * executionPrice;
      this.portfolioService.lockFunds('USDT', costUsd);
      this.portfolioService.lockFunds(baseAsset, 0);
    } else {
      this.portfolioService.lockFunds(baseAsset, order.quantity);
    }
  }

  private releaseFunds(order: PendingOrder): void {
    const baseAsset = order.symbol.split('/')[0];

    if (order.side === 'buy') {
      const executionPrice = order.type === 'market'
        ? this.marketService.getCurrentPrice(order.symbol)
        : order.price;
      const costUsd = (order.quantity - order.filled) * executionPrice;
      this.portfolioService.unlockFunds('USDT', costUsd);
    } else {
      this.portfolioService.unlockFunds(baseAsset, order.quantity - order.filled);
    }
  }

  private executeMarketOrder(order: PendingOrder): void {
    const currentPrice = this.marketService.getCurrentPrice(order.symbol);
    const baseAsset = order.symbol.split('/')[0];

    order.status = 'pending';
    this.addActiveOrder(order);

    const sub = timer(this.EXECUTION_DELAY_MS).pipe(
      take(1),
      tap(() => {
        order.filled = order.quantity;
        order.price = currentPrice;
        order.status = 'filled';
        order.updatedAt = Date.now();

        this.portfolioService.processFilling({
          asset: baseAsset,
          quantity: order.quantity,
          side: order.side,
          executionPrice: currentPrice,
        });

        this.moveToHistory(order);
        this.removeActiveOrder(order.id);
      })
    ).subscribe();

    this.addOrderSubCleanup(order, sub);
  }

  private monitorLimitOrder(order: PendingOrder): void {
    this.addActiveOrder(order);

    const ticker$ = this.marketService.getTickerBySymbol$(order.symbol);
    if (!ticker$) {
      order.status = 'cancelled';
      this.releaseFunds(order);
      this.moveToHistory(order);
      this.removeActiveOrder(order.id);
      return;
    }

    const sub = ticker$.pipe(
      filter(() => {
        const current = this.activeOrdersSubject.value.find(o => o.id === order.id);
        return current?.status === 'open';
      }),
      map(ticker => ticker.price),
      filter(currentPrice => this.shouldExecuteLimit(order, currentPrice)),
      take(1),
      switchMap(ticker => {
        const baseAsset = order.symbol.split('/')[0];
        const executionPrice = this.resolveExecutionPrice(order, ticker);

        order.filled = order.quantity;
        order.price = executionPrice;
        order.status = 'filled';
        order.updatedAt = Date.now();

        this.portfolioService.processFilling({
          asset: baseAsset,
          quantity: order.quantity,
          side: order.side,
          executionPrice,
        });

        this.moveToHistory(order);
        this.removeActiveOrder(order.id);
        return EMPTY;
      })
    ).subscribe();

    this.addOrderSubCleanup(order, sub);
  }

  private shouldExecuteLimit(order: PendingOrder, currentPrice: number): boolean {
    if (order.side === 'buy') {
      return currentPrice <= order.price;
    }
    return currentPrice >= order.price;
  }

  private resolveExecutionPrice(order: PendingOrder, currentPrice: number): number {
    if (order.type === 'market') return currentPrice;

    if (order.side === 'buy') {
      return Math.min(currentPrice, order.price);
    }
    return Math.max(currentPrice, order.price);
  }

  private startOrderProcessor(): void {
    const sub = this.orderQueue$.pipe(
      concatMap(order => {
        return of(order).pipe(delay(this.EXECUTION_DELAY_MS));
      })
    ).subscribe();

    this.addSubCleanup(sub);
  }

  private addActiveOrder(order: PendingOrder): void {
    const current = this.activeOrdersSubject.value;
    this.activeOrdersSubject.next([...current, order]);
  }

  private removeActiveOrder(orderId: string): void {
    const filtered = this.activeOrdersSubject.value.filter(o => o.id !== orderId);
    this.activeOrdersSubject.next(filtered);
  }

  private moveToHistory(order: Order): void {
    const history = [order, ...this.orderHistorySubject.value];
    if (history.length > this.MAX_ORDER_HISTORY) {
      history.length = this.MAX_ORDER_HISTORY;
    }
    this.orderHistorySubject.next(history);
  }

  private generateOrderId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `ORD-${timestamp}-${random}`.toUpperCase();
  }

  private addOrderSubCleanup(order: PendingOrder, sub: Subscription): void {
    order.intervalCleanup$ = sub;
    this.addSubCleanup(sub);
  }

  private addSubCleanup(sub: Subscription): void {
    const destroySub = this.destroy$.pipe(take(1)).subscribe(() => sub.unsubscribe());
  }
}
