export type CryptoRange = '1d' | '5d' | '1m' | '6m' | '1y';

export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  kind: 'crypto';
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  points: number[];
  image?: string;
}

export interface CryptoSource {
  provider: string;
  sourceUrl: string;
  asOf: string | null;
  stale: boolean;
  notice?: string;
}

export interface CryptoDashboard extends CryptoSource {
  assets: CryptoAsset[];
  top: CryptoAsset[];
  configured: boolean;
}

export interface CryptoSearch extends CryptoSource {
  assets: CryptoAsset[];
}

export interface CryptoDetail extends CryptoSource {
  asset: CryptoAsset;
}

export interface CryptoHistory {
  points: { time: number; value: number }[];
  provider: string;
  currency: 'USD';
  asOf: string | null;
  stale: boolean;
  notice?: string;
}
