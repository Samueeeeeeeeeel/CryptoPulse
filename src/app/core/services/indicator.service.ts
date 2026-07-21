import { Injectable } from '@angular/core';
import { Candle } from '../models/market.model';

export interface IndicatorSet {
  ema: number[];
  rsi: number[];
}

@Injectable({ providedIn: 'root' })
export class IndicatorService {

  compute(candles: Candle[], period: number = 14): IndicatorSet {
    const closes = candles.map(c => c.close);
    return {
      ema: this.ema(closes, period),
      rsi: this.rsi(closes, period),
    };
  }

  ema(closes: number[], period: number): number[] {
    if (closes.length === 0) return [];

    const result: number[] = [];
    const k = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < Math.min(period, closes.length); i++) {
      sum += closes[i];
    }

    const firstEma = sum / Math.min(period, closes.length);

    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        result.push(NaN);
      } else if (i === period - 1) {
        result.push(firstEma);
      } else {
        const prev = result[i - 1];
        result.push(closes[i] * k + prev * (1 - k));
      }
    }

    return result;
  }

  rsi(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) return closes.map(() => NaN);

    const result: number[] = [];

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    result.push(NaN);
    for (let i = 0; i < period - 1; i++) {
      result.push(NaN);
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

      const rsVal = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rsVal));
    }

    return result;
  }

  computeVisible(fullValues: number[], totalCandles: number, visibleCount: number): number[] {
    const offset = totalCandles - visibleCount;
    const visible: number[] = [];

    for (let i = Math.max(0, offset); i < fullValues.length; i++) {
      visible.push(fullValues[i]);
    }

    return visible;
  }
}
