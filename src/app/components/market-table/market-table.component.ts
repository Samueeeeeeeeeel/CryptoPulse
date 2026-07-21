import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  NgZone,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { MarketService } from '../../core/services/market.service';
import { Ticker } from '../../core/models/market.model';

@Component({
  selector: 'app-market-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="panel flex flex-col h-full overflow-hidden">
      <div class="panel-header">
        <span>Markets</span>
        <span class="text-neon-green text-xs font-mono animate-pulse-live">● LIVE</span>
      </div>

      <div class="flex-1 overflow-y-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-text-muted border-b border-slate-border">
              <th class="text-left px-3 py-2 font-medium">Pair</th>
              <th class="text-right px-3 py-2 font-medium">Price</th>
              <th class="text-right px-3 py-2 font-medium">24h %</th>
            </tr>
          </thead>
          <tbody>
            @for (ticker of tickers(); track ticker.symbol) {
              <tr class="border-b border-slate-border/50 cursor-pointer transition-colors duration-150 hover:bg-slate-hover"
                  [class.bg-slate-mid]="isSelected(ticker.symbol)"
                  [class.border-l-2]="isSelected(ticker.symbol)"
                  [class.border-l-neon-blue]="isSelected(ticker.symbol)"
                  (click)="selectAsset(ticker.symbol)">
                <td class="px-3 py-2.5">
                  <div class="flex flex-col">
                    <span class="font-semibold text-text-primary">{{ ticker.baseAsset }}</span>
                    <span class="text-text-muted text-[10px]">/{{ ticker.quoteAsset }}</span>
                  </div>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <span class="mono font-medium transition-colors duration-200"
                        [class]="getPriceClass(ticker.symbol)">
                    {{ formatPrice(ticker.price, ticker.symbol) }}
                  </span>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <span class="mono font-semibold px-1.5 py-0.5 rounded text-[11px]"
                        [class]="ticker.changePercent24h >= 0
                          ? 'text-neon-green bg-neon-green/10'
                          : 'text-neon-red bg-neon-red/10'">
                    {{ ticker.changePercent24h >= 0 ? '+' : '' }}{{ ticker.changePercent24h.toFixed(2) }}%
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </aside>
  `,
})
export class MarketTableComponent implements OnInit, OnDestroy {
  readonly marketService = inject(MarketService);
  private readonly ngZone = inject(NgZone);
  private readonly destroy$ = new Subject<void>();

  readonly tickers = signal<Ticker[]>([]);
  readonly selectedSymbol = signal('BTC/USDT');
  private readonly previousPrices = new Map<string, number>();

  ngOnInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.marketService.tickers$
        .pipe(takeUntil(this.destroy$))
        .subscribe(tickers => {
          this.tickers.set(tickers);
        });

      this.marketService.selectedSymbol$
        .pipe(takeUntil(this.destroy$))
        .subscribe(symbol => {
          this.selectedSymbol.set(symbol);
        });
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isSelected(symbol: string): boolean {
    return this.selectedSymbol() === symbol;
  }

  selectAsset(symbol: string): void {
    this.marketService.selectSymbol(symbol);
  }

  getPriceClass(symbol: string): string {
    const current = this.tickers().find(t => t.symbol === symbol);
    const prev = this.previousPrices.get(symbol);
    if (!current || prev === undefined) return 'text-text-primary';

    const changed = current.price !== prev;
    this.previousPrices.set(symbol, current.price);

    if (!changed) return 'text-text-primary';
    return current.price > prev ? 'flash-up text-neon-green' : 'flash-down text-neon-red';
  }

  formatPrice(price: number, _symbol: string): string {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.01) return price.toFixed(6);
    return price.toFixed(8);
  }
}
