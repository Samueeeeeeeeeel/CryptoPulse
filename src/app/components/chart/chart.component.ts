import {
  Component,
  inject,
  signal,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  NgZone,
} from '@angular/core';
import { Subject, takeUntil, combineLatest, withLatestFrom } from 'rxjs';
import { MarketService } from '../../core/services/market.service';
import { IndicatorService } from '../../core/services/indicator.service';
import { Candle, Ticker } from '../../core/models/market.model';

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `
    <div class="panel flex flex-col h-full overflow-hidden">
      <div class="panel-header">
        <div class="flex items-center gap-3">
          @if (activeTicker()) {
            <span class="text-text-primary font-semibold text-sm">{{ activeTicker()!.baseAsset }}/{{ activeTicker()!.quoteAsset }}</span>
            <span class="mono text-sm"
                  [class]="activeTicker()!.changePercent24h >= 0 ? 'text-neon-green' : 'text-neon-red'">
              {{ formatPrice(activeTicker()!.price) }}
            </span>
            <span class="mono text-xs"
                  [class]="activeTicker()!.changePercent24h >= 0 ? 'text-neon-green' : 'text-neon-red'">
              {{ activeTicker()!.changePercent24h >= 0 ? '+' : '' }}{{ activeTicker()!.changePercent24h.toFixed(2) }}%
            </span>
          }
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-muted text-xs mr-2">5s candles</span>

          <button class="px-2 py-0.5 text-[10px] font-semibold rounded border transition-all duration-150 uppercase tracking-wider"
                  [class]="showEma()
                    ? 'border-neon-amber/40 bg-neon-amber/10 text-neon-amber'
                    : 'border-slate-border bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="toggleEma()">
            EMA 14
          </button>

          <button class="px-2 py-0.5 text-[10px] font-semibold rounded border transition-all duration-150 uppercase tracking-wider"
                  [class]="showRsi()
                    ? 'border-neon-purple/40 bg-neon-purple/10 text-neon-purple'
                    : 'border-slate-border bg-transparent text-text-muted hover:text-text-secondary'"
                  (click)="toggleRsi()">
            RSI 14
          </button>
        </div>
      </div>

      <div class="flex-1 relative bg-abyss min-h-0" #chartContainer>
        <canvas #chartCanvas class="absolute inset-0 w-full h-full"></canvas>

        @if (showCrosshair()) {
          <div class="absolute pointer-events-none text-[10px] mono px-1.5 py-0.5 bg-slate-deep border border-slate-border rounded z-10"
               [style.top.px]="crosshairY() - 14"
               [style.left.px]="crosshairX() + 10">
            {{ crosshairPrice() }}
          </div>
          <div class="absolute pointer-events-none text-[10px] mono px-1.5 py-0.5 bg-slate-deep border border-slate-border rounded z-10"
               [style.left.px]="crosshairX() - 20"
               [style.top.px]="chartHeight() - 16">
            {{ crosshairTime() }}
          </div>
        }
      </div>

      <div class="h-8 border-t border-slate-border flex items-center px-3 gap-4 text-[10px] text-text-muted">
        <span>O <b class="text-text-secondary mono">{{ formatPrice(activeCandle()?.open ?? 0) }}</b></span>
        <span>H <b class="text-neon-green mono">{{ formatPrice(activeCandle()?.high ?? 0) }}</b></span>
        <span>L <b class="text-neon-red mono">{{ formatPrice(activeCandle()?.low ?? 0) }}</b></span>
        <span>C <b class="text-text-secondary mono">{{ formatPrice(activeCandle()?.close ?? 0) }}</b></span>
        <span class="ml-auto">Vol <b class="text-text-secondary mono">{{ formatVolume(activeCandle()?.volume ?? 0) }}</b></span>
        @if (showEma()) {
          <span>EMA <b class="text-neon-amber mono">{{ formatPrice(lastEmaValue()) }}</b></span>
        }
        @if (showRsi()) {
          <span>RSI <b class="text-neon-purple mono">{{ lastRsiValue().toFixed(1) }}</b></span>
        }
      </div>
    </div>
  `,
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartContainer', { static: true }) containerRef!: ElementRef<HTMLDivElement>;

  readonly marketService = inject(MarketService);
  private readonly indicatorService = inject(IndicatorService);
  private readonly ngZone = inject(NgZone);
  private readonly destroy$ = new Subject<void>();

  readonly activeTicker = signal<Ticker | null>(null);
  readonly activeCandle = signal<Candle | null>(null);
  readonly showCrosshair = signal(false);
  readonly crosshairX = signal(0);
  readonly crosshairY = signal(0);
  readonly crosshairPrice = signal('');
  readonly crosshairTime = signal('');
  readonly chartHeight = signal(400);
  readonly showEma = signal(true);
  readonly showRsi = signal(true);
  readonly lastEmaValue = signal(0);
  readonly lastRsiValue = signal(50);

  private ctx!: CanvasRenderingContext2D;
  private candles: Candle[] = [];
  private animationId = 0;
  private fullEma: number[] = [];
  private fullRsi: number[] = [];

  private readonly PADDING = { top: 20, right: 70, bottom: 30, left: 10 };
  private readonly RSI_HEIGHT_RATIO = 0.22;
  private readonly RSI_GAP = 6;

  private readonly COLORS = {
    bg: '#0a0c14',
    grid: 'rgba(42, 49, 72, 0.4)',
    gridText: '#5a6478',
    bullish: '#00ff88',
    bullishBody: 'rgba(0, 255, 136, 0.15)',
    bearish: '#ff3366',
    bearishBody: 'rgba(255, 51, 102, 0.15)',
    volumeUp: 'rgba(0, 255, 136, 0.08)',
    volumeDown: 'rgba(255, 51, 102, 0.08)',
    crosshair: 'rgba(136, 146, 168, 0.3)',
    ema: '#ffaa00',
    emaGlow: 'rgba(255, 170, 0, 0.3)',
    rsi: '#aa55ff',
    rsiZone: 'rgba(170, 85, 255, 0.08)',
    rsiOverbought: 'rgba(255, 51, 102, 0.4)',
    rsiOversold: 'rgba(0, 255, 136, 0.4)',
    rsiLine: '#aa55ff',
  };

  ngAfterViewInit(): void {
    const container = this.containerRef.nativeElement;
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.chartHeight.set(container.clientHeight);

    this.setupResizeObserver();
    this.setupCrosshair();
    this.subscribeToData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    cancelAnimationFrame(this.animationId);
  }

  toggleEma(): void {
    this.showEma.update(v => !v);
    this.render();
  }

  toggleRsi(): void {
    this.showRsi.update(v => !v);
    this.render();
  }

  formatPrice(price: number): string {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.01) return price.toFixed(6);
    return price.toFixed(8);
  }

  formatVolume(volume: number): string {
    if (volume >= 1000) return (volume / 1000).toFixed(1) + 'K';
    return volume.toFixed(2);
  }

  private setupResizeObserver(): void {
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this.chartHeight.set(entry.contentRect.height);
      }
    });
    resizeObserver.observe(this.containerRef.nativeElement);
  }

  private setupCrosshair(): void {
    const canvas = this.canvasRef.nativeElement;

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const rsiH = this.getRsiPanelHeight(h);

      if (x > this.PADDING.left && x < w - this.PADDING.right &&
          y > this.PADDING.top && y < h - this.PADDING.bottom - rsiH) {
        this.showCrosshair.set(true);
        this.crosshairX.set(x);
        this.crosshairY.set(y);

        const priceRange = this.getPriceRange();
        const plotHeight = h - this.PADDING.top - this.PADDING.bottom - rsiH;
        const price = priceRange.max - ((y - this.PADDING.top) / plotHeight) * (priceRange.max - priceRange.min);
        this.crosshairPrice.set(this.formatPrice(price));

        const visibleCount = this.getVisibleCandleCount(w);
        const candleW = this.getCandleWidth(w, visibleCount);
        const candleIndex = Math.floor((x - this.PADDING.left) / candleW);
        const candle = this.candles[this.candles.length - visibleCount + candleIndex];
        if (candle) {
          const d = new Date(candle.timestamp);
          this.crosshairTime.set(
            `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
          );
        }
      } else {
        this.showCrosshair.set(false);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      this.showCrosshair.set(false);
    });
  }

  private subscribeToData(): void {
    this.ngZone.runOutsideAngular(() => {
      combineLatest([
        this.marketService.selectedSymbol$,
        this.marketService.tickers$,
      ]).pipe(
        withLatestFrom(this.marketService.recentTrades$),
        takeUntil(this.destroy$),
      ).subscribe(([[symbol, tickers], _]) => {
        const ticker = tickers.find(t => t.symbol === symbol);
        if (ticker) this.activeTicker.set(ticker);

        this.candles = this.marketService.getCandleHistory(symbol);
        const lastCandle = this.candles[this.candles.length - 1];
        if (lastCandle) this.activeCandle.set(lastCandle);

        this.computeIndicators();
        this.render();
      });
    });
  }

  private computeIndicators(): void {
    if (this.candles.length < 15) {
      this.fullEma = [];
      this.fullRsi = [];
      this.lastEmaValue.set(0);
      this.lastRsiValue.set(50);
      return;
    }

    const indicators = this.indicatorService.compute(this.candles, 14);
    this.fullEma = indicators.ema;
    this.fullRsi = indicators.rsi;

    const lastEma = this.fullEma[this.fullEma.length - 1];
    const lastRsi = this.fullRsi[this.fullRsi.length - 1];

    if (!isNaN(lastEma)) this.lastEmaValue.set(lastEma);
    if (!isNaN(lastRsi)) this.lastRsiValue.set(lastRsi);
  }

  private render(): void {
    cancelAnimationFrame(this.animationId);
    this.animationId = requestAnimationFrame(() => this.draw());
  }

  private getRsiPanelHeight(canvasHeight: number): number {
    if (!this.showRsi()) return 0;
    return canvasHeight * this.RSI_HEIGHT_RATIO;
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const w = this.containerRef.nativeElement.clientWidth;
    const h = this.containerRef.nativeElement.clientHeight;
    const rsiH = this.getRsiPanelHeight(h);

    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);

    this.ctx.fillStyle = this.COLORS.bg;
    this.ctx.fillRect(0, 0, w, h);

    if (this.candles.length === 0) return;

    const visibleCount = this.getVisibleCandleCount(w);
    const visibleCandles = this.candles.slice(-visibleCount);
    const priceRange = this.getPriceRangeForCandles(visibleCandles);

    this.drawGrid(w, h, priceRange, rsiH);
    this.drawVolume(w, h, visibleCandles, rsiH);
    this.drawCandles(w, h, visibleCandles, priceRange, rsiH);

    if (this.showEma()) {
      this.drawEma(w, h, visibleCount, priceRange, rsiH);
    }

    this.drawPriceScale(w, h, priceRange, rsiH);

    if (this.showRsi()) {
      this.drawRsiPanel(w, h, visibleCount, rsiH);
    }
  }

  private drawGrid(w: number, h: number, priceRange: { min: number; max: number }, rsiH: number): void {
    const plotH = h - this.PADDING.top - this.PADDING.bottom - rsiH;
    const gridLines = 6;

    this.ctx.strokeStyle = this.COLORS.grid;
    this.ctx.lineWidth = 0.5;
    this.ctx.fillStyle = this.COLORS.gridText;
    this.ctx.font = '10px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'right';

    for (let i = 0; i <= gridLines; i++) {
      const y = this.PADDING.top + (plotH / gridLines) * i;
      const price = priceRange.max - (i / gridLines) * (priceRange.max - priceRange.min);

      this.ctx.beginPath();
      this.ctx.moveTo(this.PADDING.left, y);
      this.ctx.lineTo(w - this.PADDING.right, y);
      this.ctx.stroke();

      this.ctx.fillText(this.formatPrice(price), w - 8, y + 3);
    }
  }

  private drawVolume(w: number, h: number, candles: Candle[], rsiH: number): void {
    const plotW = w - this.PADDING.left - this.PADDING.right;
    const plotH = h - this.PADDING.top - this.PADDING.bottom - rsiH;
    const maxVol = Math.max(...candles.map(c => c.volume), 1);
    const volHeight = plotH * 0.15;
    const candleW = plotW / candles.length;
    const bodyW = Math.max(candleW * 0.6, 1);

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = this.PADDING.left + i * candleW;
      const barH = (c.volume / maxVol) * volHeight;
      const bullish = c.close >= c.open;

      this.ctx.fillStyle = bullish ? this.COLORS.volumeUp : this.COLORS.volumeDown;
      this.ctx.fillRect(
        x + (candleW - bodyW) / 2,
        h - this.PADDING.bottom - rsiH - barH,
        bodyW,
        barH
      );
    }
  }

  private drawCandles(
    w: number,
    h: number,
    candles: Candle[],
    priceRange: { min: number; max: number },
    rsiH: number
  ): void {
    const plotW = w - this.PADDING.left - this.PADDING.right;
    const plotH = h - this.PADDING.top - this.PADDING.bottom - rsiH;
    const candleW = plotW / candles.length;
    const bodyW = Math.max(candleW * 0.55, 2);
    const range = priceRange.max - priceRange.min;

    const priceToY = (price: number) =>
      this.PADDING.top + ((priceRange.max - price) / range) * plotH;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = this.PADDING.left + i * candleW + candleW / 2;
      const bullish = c.close >= c.open;
      const color = bullish ? this.COLORS.bullish : this.COLORS.bearish;

      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, priceToY(c.high));
      this.ctx.lineTo(x, priceToY(c.low));
      this.ctx.stroke();

      const bodyTop = priceToY(Math.max(c.open, c.close));
      const bodyBottom = priceToY(Math.min(c.open, c.close));
      const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

      this.ctx.fillStyle = bullish ? this.COLORS.bullishBody : this.COLORS.bearishBody;
      this.ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);

      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);
    }
  }

  private drawEma(
    w: number,
    h: number,
    visibleCount: number,
    priceRange: { min: number; max: number },
    rsiH: number
  ): void {
    if (this.fullEma.length === 0) return;

    const plotW = w - this.PADDING.left - this.PADDING.right;
    const plotH = h - this.PADDING.top - this.PADDING.bottom - rsiH;
    const candleW = plotW / visibleCount;
    const range = priceRange.max - priceRange.min;

    const visibleEma = this.indicatorService.computeVisible(
      this.fullEma, this.candles.length, visibleCount
    );

    const priceToY = (price: number) =>
      this.PADDING.top + ((priceRange.max - price) / range) * plotH;

    this.ctx.save();

    this.ctx.strokeStyle = this.COLORS.emaGlow;
    this.ctx.lineWidth = 3;
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();

    let started = false;
    for (let i = 0; i < visibleEma.length; i++) {
      const val = visibleEma[i];
      if (isNaN(val)) continue;

      const x = this.PADDING.left + i * candleW + candleW / 2;
      const y = priceToY(val);

      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();

    this.ctx.strokeStyle = this.COLORS.ema;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    started = false;

    for (let i = 0; i < visibleEma.length; i++) {
      const val = visibleEma[i];
      if (isNaN(val)) continue;

      const x = this.PADDING.left + i * candleW + candleW / 2;
      const y = priceToY(val);

      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();

    this.ctx.restore();
  }

  private drawPriceScale(w: number, h: number, priceRange: { min: number; max: number }, rsiH: number): void {
    const lastCandle = this.candles[this.candles.length - 1];
    if (!lastCandle) return;

    const plotH = h - this.PADDING.top - this.PADDING.bottom - rsiH;
    const range = priceRange.max - priceRange.min;
    const y = this.PADDING.top + ((priceRange.max - lastCandle.close) / range) * plotH;

    this.ctx.strokeStyle = lastCandle.close >= lastCandle.open
      ? this.COLORS.bullish
      : this.COLORS.bearish;
    this.ctx.lineWidth = 0.8;
    this.ctx.setLineDash([4, 3]);
    this.ctx.beginPath();
    this.ctx.moveTo(this.PADDING.left, y);
    this.ctx.lineTo(w - this.PADDING.right, y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawRsiPanel(w: number, h: number, visibleCount: number, rsiH: number): void {
    if (rsiH <= 0 || this.fullRsi.length === 0) return;

    const plotW = w - this.PADDING.left - this.PADDING.right;
    const panelTop = h - this.PADDING.bottom - rsiH;
    const panelH = rsiH - 4;

    this.ctx.fillStyle = 'rgba(10, 12, 20, 0.7)';
    this.ctx.fillRect(this.PADDING.left, panelTop, plotW, panelH);

    this.ctx.strokeStyle = 'rgba(42, 49, 72, 0.6)';
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeRect(this.PADDING.left, panelTop, plotW, panelH);

    const lineY = (level: number) => panelTop + ((100 - level) / 100) * panelH;

    this.ctx.fillStyle = this.COLORS.gridText;
    this.ctx.font = '9px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'left';

    this.ctx.fillText('RSI(14)', this.PADDING.left + 4, panelTop + 10);

    this.ctx.textAlign = 'right';
    this.ctx.fillText('70', w - this.PADDING.right - 2, lineY(70) - 2);
    this.ctx.fillText('50', w - this.PADDING.right - 2, lineY(50) - 2);
    this.ctx.fillText('30', w - this.PADDING.right - 2, lineY(30) - 2);

    this.ctx.setLineDash([2, 3]);
    this.ctx.lineWidth = 0.5;

    this.ctx.strokeStyle = this.COLORS.rsiOverbought;
    this.ctx.beginPath();
    this.ctx.moveTo(this.PADDING.left, lineY(70));
    this.ctx.lineTo(w - this.PADDING.right, lineY(70));
    this.ctx.stroke();

    this.ctx.strokeStyle = this.COLORS.rsiOversold;
    this.ctx.beginPath();
    this.ctx.moveTo(this.PADDING.left, lineY(30));
    this.ctx.lineTo(w - this.PADDING.right, lineY(30));
    this.ctx.stroke();

    this.ctx.strokeStyle = 'rgba(90, 100, 120, 0.3)';
    this.ctx.beginPath();
    this.ctx.moveTo(this.PADDING.left, lineY(50));
    this.ctx.lineTo(w - this.PADDING.right, lineY(50));
    this.ctx.stroke();

    this.ctx.setLineDash([]);

    this.ctx.fillStyle = 'rgba(255, 51, 102, 0.04)';
    this.ctx.fillRect(this.PADDING.left, panelTop, plotW, lineY(70) - panelTop);

    this.ctx.fillStyle = 'rgba(0, 255, 136, 0.04)';
    this.ctx.fillRect(this.PADDING.left, lineY(30), plotW, panelTop + panelH - lineY(30));

    const visibleRsi = this.indicatorService.computeVisible(
      this.fullRsi, this.candles.length, visibleCount
    );

    const candleW = plotW / visibleCount;
    const rsiToY = (val: number) => panelTop + ((100 - val) / 100) * panelH;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(this.PADDING.left, panelTop, plotW, panelH);
    this.ctx.clip();

    this.ctx.strokeStyle = this.COLORS.rsiLine;
    this.ctx.lineWidth = 1.5;
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();

    let started = false;
    for (let i = 0; i < visibleRsi.length; i++) {
      const val = visibleRsi[i];
      if (isNaN(val)) continue;

      const x = this.PADDING.left + i * candleW + candleW / 2;
      const y = rsiToY(val);

      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();

    this.ctx.restore();
  }

  private getVisibleCandleCount(canvasWidth: number): number {
    const plotW = canvasWidth - this.PADDING.left - this.PADDING.right;
    return Math.min(Math.max(Math.floor(plotW / 10), 20), this.candles.length);
  }

  private getCandleWidth(canvasWidth: number, visibleCount: number): number {
    const plotW = canvasWidth - this.PADDING.left - this.PADDING.right;
    return plotW / visibleCount;
  }

  private getPriceRange(): { min: number; max: number } {
    return this.getPriceRangeForCandles(this.candles.slice(-this.getVisibleCandleCount(
      this.containerRef.nativeElement.clientWidth
    )));
  }

  private getPriceRangeForCandles(candles: Candle[]): { min: number; max: number } {
    if (candles.length === 0) return { min: 0, max: 100 };

    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }

    if (this.showEma() && this.fullEma.length > 0) {
      const visibleEma = this.indicatorService.computeVisible(
        this.fullEma, this.candles.length, candles.length
      );
      for (const val of visibleEma) {
        if (!isNaN(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    const padding = (max - min) * 0.05;
    return { min: min - padding, max: max + padding };
  }
}
