import { Component, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/portfolio.model';

type TabId = 'active' | 'history';

@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <div class="panel flex flex-col border-t border-slate-border" [style.height.px]="expanded() ? 220 : 36">
      <div class="flex items-center justify-between px-3 h-9 bg-slate-deep border-b border-slate-border cursor-pointer select-none shrink-0"
           (click)="toggle()">
        <div class="flex items-center gap-1">
          <button class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors duration-150"
                  [class]="activeTab() === 'active'
                    ? 'bg-neon-blue/15 text-neon-blue'
                    : 'text-text-muted hover:text-text-secondary'"
                  (click)="switchTab('active'); $event.stopPropagation()">
            Active Orders
            @if ((activeOrders$ | async)?.length; as count) {
              <span class="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-neon-blue/20 text-neon-blue text-[9px] font-bold">
                {{ count }}
              </span>
            }
          </button>
          <button class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors duration-150"
                  [class]="activeTab() === 'history'
                    ? 'bg-neon-blue/15 text-neon-blue'
                    : 'text-text-muted hover:text-text-secondary'"
                  (click)="switchTab('history'); $event.stopPropagation()">
            History
          </button>
        </div>
        <div class="flex items-center gap-2">
          @if (activeTab() === 'history') {
            <span class="text-[10px] text-text-muted mono">{{ (history$ | async)?.length ?? 0 }} orders</span>
          }
          <svg class="w-3.5 h-3.5 text-text-muted transition-transform duration-200"
               [class.rotate-180]="expanded()"
               viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 8L6 4L10 8" />
          </svg>
        </div>
      </div>

      @if (expanded()) {
        <div class="flex-1 overflow-hidden min-h-0">
          @if (activeTab() === 'active') {
            @if (activeOrders$ | async; as activeOrders) {
              @if (activeOrders.length > 0) {
                <div class="h-full overflow-y-auto">
                  <table class="w-full text-[11px]">
                    <thead>
                      <tr class="text-text-muted border-b border-slate-border/60 sticky top-0 bg-slate-deep">
                        <th class="text-left px-3 py-1.5 font-medium">Time</th>
                        <th class="text-left px-3 py-1.5 font-medium">Pair</th>
                        <th class="text-left px-3 py-1.5 font-medium">Type</th>
                        <th class="text-left px-3 py-1.5 font-medium">Side</th>
                        <th class="text-right px-3 py-1.5 font-medium">Price</th>
                        <th class="text-right px-3 py-1.5 font-medium">Amount</th>
                        <th class="text-right px-3 py-1.5 font-medium">Filled</th>
                        <th class="text-center px-3 py-1.5 font-medium w-20">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (order of activeOrders; track order.id) {
                        <tr class="border-b border-slate-border/30 hover:bg-slate-hover/50 transition-colors">
                          <td class="px-3 py-1.5 mono text-text-muted">{{ formatTime(order.createdAt) }}</td>
                          <td class="px-3 py-1.5 text-text-primary font-medium">{{ order.symbol }}</td>
                          <td class="px-3 py-1.5">
                            <span class="px-1.5 py-0.5 rounded bg-neon-blue/10 text-neon-blue text-[10px] font-semibold uppercase">
                              {{ order.type === 'market' ? 'MKT' : 'LMT' }}
                            </span>
                          </td>
                          <td class="px-3 py-1.5">
                            <span class="text-[10px] font-bold uppercase"
                                  [class]="order.side === 'buy' ? 'text-neon-green' : 'text-neon-red'">
                              {{ order.side === 'buy' ? 'BUY' : 'SELL' }}
                            </span>
                          </td>
                          <td class="px-3 py-1.5 text-right mono">{{ formatPrice(order.price) }}</td>
                          <td class="px-3 py-1.5 text-right mono">{{ order.quantity.toFixed(6) }}</td>
                          <td class="px-3 py-1.5 text-right mono text-text-muted">{{ order.filled.toFixed(6) }}</td>
                          <td class="px-3 py-1.5 text-center">
                            <button class="px-2 py-0.5 rounded text-[10px] font-semibold bg-neon-red/10 text-neon-red border border-neon-red/20 hover:bg-neon-red/20 transition-colors"
                                    (click)="cancelOrder(order.id)">
                              Cancel
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="h-full flex items-center justify-center text-text-muted text-xs">
                  No active orders
                </div>
              }
            }
          } @else {
            @if (history$ | async; as historyOrders) {
              @if (historyOrders.length > 0) {
                <div class="h-full overflow-y-auto">
                  <table class="w-full text-[11px]">
                    <thead>
                      <tr class="text-text-muted border-b border-slate-border/60 sticky top-0 bg-slate-deep">
                        <th class="text-left px-3 py-1.5 font-medium">Time</th>
                        <th class="text-left px-3 py-1.5 font-medium">Pair</th>
                        <th class="text-left px-3 py-1.5 font-medium">Type</th>
                        <th class="text-left px-3 py-1.5 font-medium">Side</th>
                        <th class="text-right px-3 py-1.5 font-medium">Exec. Price</th>
                        <th class="text-right px-3 py-1.5 font-medium">Amount</th>
                        <th class="text-center px-3 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (order of historyOrders; track order.id) {
                        <tr class="border-b border-slate-border/30 hover:bg-slate-hover/50 transition-colors">
                          <td class="px-3 py-1.5 mono text-text-muted">{{ formatTime(order.updatedAt) }}</td>
                          <td class="px-3 py-1.5 text-text-primary font-medium">{{ order.symbol }}</td>
                          <td class="px-3 py-1.5">
                            <span class="px-1.5 py-0.5 rounded bg-neon-blue/10 text-neon-blue text-[10px] font-semibold uppercase">
                              {{ order.type === 'market' ? 'MKT' : 'LMT' }}
                            </span>
                          </td>
                          <td class="px-3 py-1.5">
                            <span class="text-[10px] font-bold uppercase"
                                  [class]="order.side === 'buy' ? 'text-neon-green' : 'text-neon-red'">
                              {{ order.side === 'buy' ? 'BUY' : 'SELL' }}
                            </span>
                          </td>
                          <td class="px-3 py-1.5 text-right mono">{{ formatPrice(order.price) }}</td>
                          <td class="px-3 py-1.5 text-right mono">{{ order.quantity.toFixed(6) }}</td>
                          <td class="px-3 py-1.5 text-center">
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                                  [class]="getStatusClass(order.status)">
                              {{ order.status }}
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="h-full flex items-center justify-center text-text-muted text-xs">
                  No order history yet
                </div>
              }
            }
          }
        </div>
      }
    </div>
  `,
})
export class OrderHistoryComponent {
  private readonly orderService = inject(OrderService);

  readonly activeTab = signal<TabId>('active');
  readonly expanded = signal(true);

  readonly activeOrders$: Observable<Order[]> = this.orderService.activeOrders$;
  readonly history$: Observable<Order[]> = this.orderService.orderHistory$;

  switchTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  toggle(): void {
    this.expanded.update(v => !v);
  }

  cancelOrder(orderId: string): void {
    this.orderService.cancelOrder(orderId);
  }

  formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  }

  formatPrice(price: number): string {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'filled':
        return 'bg-neon-green/10 text-neon-green border border-neon-green/20';
      case 'cancelled':
        return 'bg-text-muted/10 text-text-muted border border-text-muted/20';
      case 'partial':
        return 'bg-neon-amber/10 text-neon-amber border border-neon-amber/20';
      default:
        return 'bg-slate-mid text-text-muted border border-slate-border';
    }
  }
}
