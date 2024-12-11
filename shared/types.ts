export interface TransactionDetails {
  protocol?: string;
  methodName?: string;
  params?: any;
  isSandwichTarget?: boolean;
  type?: "swap" | "liquidity" | "bridge" | "lending" | "sandwich" | "unknown";
  category?: string;
  value?: string;
}

export interface BlockPrediction {
  id: number;
  blockNumber: number;
  predictedTransactions: string[];
  predictedGasPrice: number;
  createdAt: string | Date;
  transactionDetails: {
    [txHash: string]: TransactionDetails;
  };
  analytics?: {
    swapCount: number;
    liquidityCount: number;
    sandwichCount: number;
    bridgeCount: number;
    lendingCount: number;
    unknownCount: number;
    totalValue: string;
  };
}

export interface BlockComparison {
  id: number;
  blockNumber: number;
  predictedTransactions: string[];
  actualTransactions: string[];
  accuracy: number;
  miner: string;
  timestamp: string | Date;
  averageGasPrice?: number;
}
