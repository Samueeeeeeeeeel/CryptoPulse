# CryptoPulse Terminal

A professional cryptocurrency trading terminal built with Angular 22, RxJS, Tailwind CSS v4, and Docker.

## Tech Stack

- **Angular 22** — Standalone Components, strict TypeScript
- **RxJS** — Reactive data layer
- **Tailwind CSS v4** — CSS-based configuration
- **Docker** — Multi-stage build (Node 22 → Nginx 1.27 Alpine)

## Features

- Real-time crypto price simulation (8 trading pairs)
- Canvas candlestick chart with EMA-14 and RSI-14 indicators
- Market and limit order execution with atomic lock/unlock
- Live portfolio PnL tracking ($10K USDT initial balance)
- Cyber-Industrial dark theme (neon green/red/amber)

## How to Run

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/Samueeeeeeeeeel/CryptoPulse.git
cd CryptoPulse

# Build and run with Docker Compose
docker compose up -d --build
```

Open your browser and go to: **http://localhost:8080**

```bash
# Stop the container
docker compose down
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/Samueeeeeeeeeel/CryptoPulse.git
cd CryptoPulse

# Install dependencies
npm install

# Start the development server
ng serve
```

Open your browser and go to: **http://localhost:4200**

The app will auto-reload when you edit source files.

### Option 3: Build for Production

```bash
# Build the project
ng build --configuration production

# Output will be in dist/cryptopulse/browser
```

## Project Structure

```
src/
├── app/
│   ├── components/
│   │   ├── chart/          # Canvas candlestick chart + EMA/RSI
│   │   ├── market-table/   # Live price list (8 pairs)
│   │   ├── navbar/         # Balance, PnL, pulse indicator
│   │   ├── order-history/  # Active orders + history drawer
│   │   └── trade-panel/    # Buy/Sell, Market/Limit orders
│   └── core/
│       ├── models/         # TypeScript interfaces
│       └── services/       # Market, Portfolio, Order, Indicator
├── styles.scss             # Tailwind v4 theme
└── main.ts
```
