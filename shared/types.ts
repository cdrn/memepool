export interface BlockPrediction {
  id: number;
  blockNumber: number;
  predictedTransactions: string[];
  predictedGasPrice: number;
  createdAt: string | Date;
  transactionDetails: {
    [txHash: string]: {
      protocol?: string;
      methodName?: string;
      params?: any;
      isSandwichTarget?: boolean;
    };
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
