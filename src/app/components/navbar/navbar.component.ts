import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Observable, map, startWith } from 'rxjs';
import { PortfolioService } from '../../core/services/portfolio.service';
import { PortfolioSummary } from '../../core/models/portfolio.model';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <nav class="flex items-center justify-between px-5 h-12 bg-abyss border-b border-slate-border">
      <div class="flex items-center gap-4">
        <span class="text-neon-blue font-bold text-sm tracking-widest uppercase">CryptoPulse</span>
        <span class="text-text-muted text-xs hidden sm:inline">Terminal</span>
      </div>

      @if (portfolio$ | async; as portfolio) {
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <span class="text-text-muted text-xs uppercase tracking-wider">Balance</span>
            <span class="mono text-text-primary text-sm font-semibold">
              {{ formatUsd(portfolio.totalUsdValue) }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-text-muted text-xs uppercase tracking-wider">PnL</span>
            <span class="mono text-sm font-semibold"
                  [class]="portfolio.totalPnl24h >= 0 ? 'text-neon-green glow-green' : 'text-neon-red glow-red'">
              {{ portfolio.totalPnl24h >= 0 ? '+' : '' }}{{ formatUsd(portfolio.totalPnl24h) }}
              ({{ portfolio.totalPnlPercent24h >= 0 ? '+' : '' }}{{ portfolio.totalPnlPercent24h.toFixed(2) }}%)
            </span>
          </div>

          <div class="h-4 w-px bg-slate-border"></div>

          <div class="flex items-center gap-1.5">
            <span class="relative flex h-2 w-2">
              <span class="animate-pulse-live absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-neon-green"></span>
            </span>
            <span class="text-neon-green text-xs font-medium tracking-wider uppercase">Live</span>
          </div>
        </div>
      }
    </nav>
  `,
})
export class NavbarComponent {
  private readonly portfolioService = inject(PortfolioService);

  readonly portfolio$: Observable<PortfolioSummary> = this.portfolioService.portfolio$.pipe(
    map(p => p ?? this.emptySummary()),
    startWith(this.emptySummary()),
  );

  formatUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private emptySummary(): PortfolioSummary {
    return {
      totalUsdValue: 10000,
      totalPnl24h: 0,
      totalPnlPercent24h: 0,
      assets: [],
      lastUpdate: Date.now(),
    };
  }
}
