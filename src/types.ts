export interface StockItem {
  /** 东财 secid，如 1.600519 / 0.000001 / 116.00700 / 105.AAPL */
  secid: string;
  /** 显示代码 */
  code: string;
  /** 市场编号：1=沪 0=深 116=港 105=美 */
  market: number;
  /** 名称（首次拉取行情后回填） */
  name?: string;
}

export interface Quote {
  secid: string;
  code: string;
  market: number;
  name: string;
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅 % */
  changePct: number;
  high: number;
  low: number;
  open: number;
  preClose: number;
  /** 成交量（手/股） */
  volume: number;
  /** 成交额（元） */
  amount: number;
  /** 行情时间戳（秒） */
  time: number;
  valid: boolean;
}
