import { ethers } from "ethers";
import axios from "axios";
import { Logger } from "winston";

interface DecodedTransaction {
  protocol?: string;
  methodName?: string;
  params?: any;
  isSandwichTarget?: boolean;
}

export class ProtocolAnalyzer {
  private provider: ethers.Provider;
  private logger: Logger;
  private abiCache: Map<string, any> = new Map();
  private knownProtocols: Map<string, string> = new Map();
  private potentialSandwiches: Map<
    string,
    {
      frontrun?: ethers.TransactionResponse;
      target?: ethers.TransactionResponse;
      backrun?: ethers.TransactionResponse;
      timestamp: number;
    }
  > = new Map();

  constructor(provider: ethers.Provider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
    this.initializeKnownProtocols();
  }

  private initializeKnownProtocols() {
    // Common DeFi protocols
    this.knownProtocols.set(
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
      "Uniswap V3"
    );
    this.knownProtocols.set(
      "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      "Uniswap V2"
    );
    this.knownProtocols.set(
      "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
      "SushiSwap"
    );
    this.knownProtocols.set(
      "0x1111111254eeb25477b68fb85ed929f73a960582",
      "1inch"
    );
    // Add more protocols as needed
  }

  async analyzeTransaction(
    tx: ethers.TransactionResponse
  ): Promise<DecodedTransaction> {
    try {
      if (!tx.to) return {};

      const result: DecodedTransaction = {
        protocol: this.knownProtocols.get(tx.to.toLowerCase()),
      };

      // Get verified ABI from cache or Etherscan
      const abi = await this.getContractABI(tx.to);
      if (!abi) return result;

      // Create contract interface
      const iface = new ethers.Interface(abi);

      try {
        // Decode transaction input
        const decoded = iface.parseTransaction({
          data: tx.data,
          value: tx.value,
        });
        if (decoded) {
          result.methodName = decoded.name;
          result.params = decoded.args;
        }
      } catch (e) {
        this.logger.debug(`Could not decode transaction to ${tx.to}`);
      }

      // Check for potential sandwich patterns
      await this.detectSandwichPattern(tx);

      return result;
    } catch (error) {
      this.logger.error("Error analyzing transaction:", error);
      return {};
    }
  }

  private async getContractABI(address: string): Promise<any> {
    if (this.abiCache.has(address)) {
      return this.abiCache.get(address);
    }

    try {
      const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
      if (!etherscanApiKey) {
        this.logger.warn("No Etherscan API key provided");
        return null;
      }

      const response = await axios.get(`https://api.etherscan.io/api`, {
        params: {
          module: "contract",
          action: "getabi",
          address: address,
          apikey: etherscanApiKey,
        },
      });

      if (response.data.status === "1") {
        const abi = JSON.parse(response.data.result);
        this.abiCache.set(address, abi);
        return abi;
      }
    } catch (error) {
      this.logger.error(`Error fetching ABI for ${address}:`, error);
    }
    return null;
  }

  private async detectSandwichPattern(tx: ethers.TransactionResponse) {
    const isSwap = this.isSwapTransaction(tx);
    if (!isSwap) return false;

    const currentTime = Date.now();
    const SANDWICH_WINDOW = 2000; // 2 seconds window

    // Clean up old entries
    for (const [key, value] of this.potentialSandwiches.entries()) {
      if (currentTime - value.timestamp > SANDWICH_WINDOW) {
        this.potentialSandwiches.delete(key);
      }
    }

    // Get transaction details
    const gasPrice = tx.maxFeePerGas || tx.gasPrice || BigInt(0);

    // Look for existing patterns
    for (const [token, pattern] of this.potentialSandwiches.entries()) {
      if (!pattern.target && this.isSameToken(tx, token)) {
        // This could be a target transaction
        if (
          pattern.frontrun &&
          this.getEffectiveGasPrice(pattern.frontrun) <
            this.getEffectiveGasPrice(tx)
        ) {
          pattern.target = tx;
          continue;
        }
      }

      if (pattern.target && !pattern.backrun && this.isSameToken(tx, token)) {
        // This could be a backrun transaction
        if (
          this.getEffectiveGasPrice(tx) >
          this.getEffectiveGasPrice(pattern.target)
        ) {
          pattern.backrun = tx;

          // Log completed sandwich pattern
          if (pattern.frontrun && pattern.target && pattern.backrun) {
            this.logger.info("Detected sandwich attack pattern", {
              frontrun: pattern.frontrun.hash,
              target: pattern.target.hash,
              backrun: tx.hash,
              token,
            });
          }
        }
      }
    }

    // Start new potential pattern
    if (!this.hasExistingPattern(tx)) {
      const token = this.getAffectedToken(tx);
      if (token) {
        this.potentialSandwiches.set(token, {
          frontrun: tx,
          timestamp: currentTime,
        });
      }
    }
  }

  private getEffectiveGasPrice(tx: ethers.TransactionResponse): bigint {
    return tx.maxFeePerGas || tx.gasPrice || BigInt(0);
  }

  private isSwapTransaction(tx: ethers.TransactionResponse): boolean {
    if (!tx.to) return false;
    const protocolName = this.knownProtocols.get(tx.to.toLowerCase());
    if (!protocolName) return false;

    // Check if transaction data contains common swap signatures
    const swapSignatures = [
      "0x38ed1739", // swapExactTokensForTokens
      "0x7ff36ab5", // swapExactETHForTokens
      "0x18cbafe5", // swapExactTokensForETH
      "0x5c11d795", // swapExactTokensForTokensSupportingFeeOnTransferTokens
    ];

    return swapSignatures.some((sig) => tx.data.startsWith(sig));
  }

  private isSameToken(tx: ethers.TransactionResponse, token: string): boolean {
    // Basic implementation - check if transaction interacts with the same token
    return tx.data.includes(token.slice(2).toLowerCase());
  }

  private getAffectedToken(tx: ethers.TransactionResponse): string | null {
    // Basic implementation - extract token address from swap data
    // This would need to be enhanced based on specific DEX patterns
    try {
      // Example: extract first token address from swap data
      const tokenAddress = "0x" + tx.data.slice(34, 74);
      return tokenAddress;
    } catch (error) {
      return null;
    }
  }

  private hasExistingPattern(tx: ethers.TransactionResponse): boolean {
    for (const pattern of this.potentialSandwiches.values()) {
      if (
        pattern.frontrun?.hash === tx.hash ||
        pattern.target?.hash === tx.hash ||
        pattern.backrun?.hash === tx.hash
      ) {
        return true;
      }
    }
    return false;
  }
}
