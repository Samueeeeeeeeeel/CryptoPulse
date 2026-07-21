import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, UpperCasePipe } from '@angular/common';
import { Subject, takeUntil, switchMap, map, of } from 'rxjs';
import { MarketService } from '../../core/services/market.service';
import { OrderService } from '../../core/services/order.service';
import { Ticker } from '../../core/models/market.model';
import { PlaceOrderPayload, OrderSide, OrderType } from '../../core/models/portfolio.model';

@Component({
  selector: 'app-trade-panel',
  standalone: true,
  imports: [FormsModule, AsyncPipe, UpperCasePipe],
  template: `
    <div class="panel flex flex-col h-full overflow-hidden">
      <div class="panel-header">
        <span>Place Order</span>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        @if (activeTicker(); as ticker) {
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-text-muted uppercase tracking-wider">{{ ticker.baseAsset }}/{{ ticker.quoteAsset }}</span>
            <span class="mono text-sm font-semibold"
                  [class]="ticker.changePercent24h >= 0 ? 'text-neon-green' : 'text-neon-red'">
              {{ formatPrice(ticker.price) }}
            </span>
          </div>
        }

        <div class="flex rounded-md overflow-hidden border border-slate-border">
          <button class="flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200"
                  [class]="side() === 'buy' ? 'bg-neon-green/15 text-neon-green' : 'bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="setSide('buy')">
            Buy
          </button>
          <button class="flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200"
                  [class]="side() === 'sell' ? 'bg-neon-red/15 text-neon-red' : 'bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="setSide('sell')">
            Sell
          </button>
        </div>

        <div class="flex rounded-md overflow-hidden border border-slate-border">
          <button class="flex-1 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-200"
                  [class]="orderType() === 'market' ? 'bg-neon-blue/15 text-neon-blue' : 'bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="setOrderType('market')">
            Market
          </button>
          <button class="flex-1 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-200"
                  [class]="orderType() === 'limit' ? 'bg-neon-blue/15 text-neon-blue' : 'bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="setOrderType('limit')">
            Limit
          </button>
        </div>

        @if (orderType() === 'limit') {
          <div>
            <label class="text-[10px] text-text-muted uppercase tracking-wider mb-1 block">Price (USDT)</label>
            <div class="relative">
              <input type="number"
                     [(ngModel)]="limitPrice"
                     [step]="getPriceStep()"
                     [min]="0"
                     class="mono w-full bg-abyss border border-slate-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-neon-blue transition-colors"
                     placeholder="0.00">
              <div class="absolute right-1 top-1 flex flex-col">
                <button class="text-text-muted hover:text-text-secondary text-[10px] px-1 leading-none" (click)="adjustPrice(1)">+</button>
                <button class="text-text-muted hover:text-text-secondary text-[10px] px-1 leading-none" (click)="adjustPrice(-1)">-</button>
              </div>
            </div>
          </div>
        }

        <div>
          <label class="text-[10px] text-text-muted uppercase tracking-wider mb-1 block">Amount ({{ activeTicker()?.baseAsset ?? '' }})</label>
          <input type="number"
                 [(ngModel)]="quantity"
                 step="0.001"
                 [min]="0"
                 class="mono w-full bg-abyss border border-slate-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-neon-blue transition-colors"
                 placeholder="0.000">
          <div class="flex gap-1 mt-1.5">
            @for (pct of [25, 50, 75, 100]; track pct) {
              <button class="flex-1 py-0.5 text-[10px] font-medium rounded bg-slate-mid text-text-muted hover:text-text-secondary hover:bg-slate-hover transition-colors"
                      (click)="setPercentage(pct)">
                {{ pct }}%
              </button>
            }
          </div>
        </div>

        <div class="bg-abyss rounded-md border border-slate-border p-2.5 space-y-1.5 text-[11px]">
          <div class="flex justify-between">
            <span class="text-text-muted">Est. Total</span>
            <span class="mono text-text-primary font-medium">{{ formatUsd(estimatedTotal()) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-muted">Available</span>
            <span class="mono text-text-secondary">{{ availableBalance() }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-muted">Fee (0.1%)</span>
            <span class="mono text-text-muted">{{ formatUsd(estimatedFee()) }}</span>
          </div>
        </div>

        <button class="w-full py-2.5 rounded-md text-sm font-bold uppercase tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                [class]="side() === 'buy'
                  ? 'bg-neon-green/20 text-neon-green border border-neon-green/30 hover:bg-neon-green/30 active:scale-[0.98]'
                  : 'bg-neon-red/20 text-neon-red border border-neon-red/30 hover:bg-neon-red/30 active:scale-[0.98]'"
                [disabled]="!canSubmit()"
                (click)="submitOrder()">
          {{ side() === 'buy' ? 'Buy' : 'Sell' }} {{ activeTicker()?.baseAsset ?? '' }}
        </button>

        @if (lastOrderResult()) {
          <div class="rounded-md border p-2 text-[11px] mono"
               [class]="lastOrderResult() === 'success'
                 ? 'border-neon-green/30 bg-neon-green/5 text-neon-green'
                 : 'border-neon-red/30 bg-neon-red/5 text-neon-red'">
            {{ lastOrderMessage() }}
          </div>
        }
      </div>

      @if ((activeOrders$ | async)?.length; as count) {
        <div class="border-t border-slate-border p-2 space-y-1">
          <div class="flex items-center justify-between text-[10px] text-text-muted uppercase tracking-wider mb-1">
            <span>Active Orders ({{ count }})</span>
            <button class="text-neon-red hover:text-neon-red-dim transition-colors" (click)="cancelAll()">Cancel All</button>
          </div>
          @for (order of activeOrders$ | async; track order.id) {
            <div class="flex items-center justify-between bg-abyss rounded px-2 py-1.5 text-[10px]">
              <div class="flex items-center gap-1.5">
                <span [class]="order.side === 'buy' ? 'text-neon-green' : 'text-neon-red'">
                  {{ order.side | uppercase }}
                </span>
                <span class="text-text-secondary">{{ order.symbol }}</span>
                <span class="mono text-text-muted">{{ order.type === 'market' ? 'MKT' : formatPrice(order.price) }}</span>
              </div>
              <button class="text-text-muted hover:text-neon-red transition-colors" (click)="cancelOrder(order.id)">✕</button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class TradePanelComponent implements OnInit, OnDestroy {
  private readonly marketService = inject(MarketService);
  private readonly orderService = inject(OrderService);
  private readonly destroy$ = new Subject<void>();

  readonly side = signal<OrderSide>('buy');
  readonly orderType = signal<OrderType>('market');
  readonly activeTicker = signal<Ticker | null>(null);
  readonly lastOrderResult = signal<'success' | 'error' | null>(null);
  readonly lastOrderMessage = signal('');

  limitPrice = 0;
  quantity = 0;

  readonly activeOrders$ = this.orderService.activeOrders$;

  readonly estimatedTotal = computed(() => {
    const ticker = this.activeTicker();
    if (!ticker) return 0;
    const price = this.orderType() === 'limit' && this.limitPrice > 0
      ? this.limitPrice
      : ticker.price;
    return this.quantity * price;
  });

  readonly estimatedFee = computed(() => this.estimatedTotal() * 0.001);

  readonly availableBalance = computed(() => {
    const ticker = this.activeTicker();
    if (!ticker) return '$0.00';

    if (this.side() === 'buy') {
      return this.formatUsd(10000);
    }
    return `${(this.quantity).toFixed(4)} ${ticker.baseAsset}`;
  });

  readonly canSubmit = computed(() => {
    if (this.quantity <= 0) return false;
    if (this.orderType() === 'limit' && this.limitPrice <= 0) return false;
    return true;
  });

  ngOnInit(): void {
    this.marketService.selectedSymbol$
      .pipe(
        switchMap(symbol => {
          const ticker$ = this.marketService.getTickerBySymbol$(symbol);
          return ticker$ ?? of(null);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(ticker => {
        if (ticker) {
          this.activeTicker.set(ticker);
          if (this.orderType() === 'market') {
            this.limitPrice = ticker.price;
          }
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setSide(side: OrderSide): void {
    this.side.set(side);
  }

  setOrderType(type: OrderType): void {
    this.orderType.set(type);
    if (type === 'market') {
      const ticker = this.activeTicker();
      if (ticker) this.limitPrice = ticker.price;
    }
  }

  setPercentage(pct: number): void {
    const ticker = this.activeTicker();
    if (!ticker) return;

    if (this.side() === 'buy') {
      const maxUsd = 10000;
      const price = this.orderType() === 'limit' ? this.limitPrice : ticker.price;
      this.quantity = parseFloat(((maxUsd * (pct / 100)) / price).toFixed(6));
    } else {
      const balance = this.marketService.getCurrentPrice(ticker.symbol) > 0 ? 0.5 : 0;
      this.quantity = parseFloat((balance * (pct / 100)).toFixed(6));
    }
  }

  adjustPrice(direction: number): void {
    const ticker = this.activeTicker();
    if (!ticker) return;
    const step = this.getPriceStep();
    this.limitPrice = parseFloat((this.limitPrice + step * direction).toFixed(6));
  }

  submitOrder(): void {
    const ticker = this.activeTicker();
    if (!ticker || !this.canSubmit()) return;

    const payload: PlaceOrderPayload = {
      symbol: ticker.symbol,
      side: this.side(),
      type: this.orderType(),
      price: this.orderType() === 'limit' ? this.limitPrice : 0,
      quantity: this.quantity,
    };

    const order = this.orderService.placeOrder(payload);

    if (order) {
      this.lastOrderResult.set('success');
      this.lastOrderMessage.set(`${this.side().toUpperCase()} ${this.quantity} ${ticker.baseAsset} — Order submitted`);
      this.quantity = 0;
    } else {
      this.lastOrderResult.set('error');
      this.lastOrderMessage.set('Order rejected — check balance');
    }

    setTimeout(() => this.lastOrderResult.set(null), 3000);
  }

  cancelOrder(orderId: string): void {
    this.orderService.cancelOrder(orderId);
  }

  cancelAll(): void {
    this.orderService.cancelAllActiveOrders();
  }

  getPriceStep(): number {
    const price = this.limitPrice || this.activeTicker()?.price || 0;
    if (price >= 1000) return 0.01;
    if (price >= 100) return 0.001;
    if (price >= 1) return 0.0001;
    return 0.00001;
  }

  formatPrice(price: number): string {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }

  formatUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}
