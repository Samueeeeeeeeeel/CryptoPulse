import { Component } from '@angular/core';
import { NavbarComponent } from './components/navbar/navbar.component';
import { MarketTableComponent } from './components/market-table/market-table.component';
import { ChartComponent } from './components/chart/chart.component';
import { TradePanelComponent } from './components/trade-panel/trade-panel.component';
import { OrderHistoryComponent } from './components/order-history/order-history.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NavbarComponent,
    MarketTableComponent,
    ChartComponent,
    TradePanelComponent,
    OrderHistoryComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
