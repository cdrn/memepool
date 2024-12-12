import { ethers } from "ethers";
import axios from "axios";
import { Logger } from "winston";

interface TransactionDetails {
  protocol?: string;
  methodName?: string;
  params?: any;
  isSandwichTarget?: boolean;
  type?:
    | "swap"
    | "liquidity"
    | "bridge"
    | "lending"
    | "sandwich"
    | "unknown"
    | "transfer";
  value?: string;
  category?: string;
}

interface SandwichInfo {
  isSandwich: boolean;
  isTarget: boolean;
}

// Type for the common ABIs mapping
type CommonABIs = {
  [address: string]: string[];
};

// Common ABIs for known protocols
const COMMON_ABIS: CommonABIs = {
  // Uniswap V2 Router
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": [
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
    "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)",
  ],
  // Uniswap V3 Router
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": [
    "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
    "function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)",
  ],
  // AAVE V2 Lending Pool
  "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9": [
    "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
    "function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256)",
    "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  ],
  // Curve 3pool
  "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7": [
    "function add_liquidity(uint256[3] memory amounts, uint256 min_mint_amount) external",
    "function remove_liquidity(uint256 _amount, uint256[3] memory min_amounts) external",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external",
  ],
};

// Method signatures for transaction type identification
const METHOD_SIGNATURES = {
  SWAP: [
    "0x38ed1739", // swapExactTokensForTokens
    "0x7ff36ab5", // swapExactETHForTokens
    "0x18cbafe5", // swapExactTokensForETH
    "0x5c11d795", // swapExactTokensForTokensSupportingFeeOnTransferTokens
    "0xc04b8d59", // exactInput
    "0xdb3e2198", // exactOutput
    "0x791ac947", // swapExactTokensForTokensSupportingFeeOnTransferTokens
    "0x472b43f3", // swapExactTokensForTokens
  ],
  LIQUIDITY: [
    "0xe8e33700", // addLiquidity
    "0xbaa2abde", // removeLiquidity
    "0x4515cef3", // add_liquidity (Curve)
    "0x87b21efc", // deposit (Balancer)
  ],
  LENDING: [
    "0xe8eda9df", // deposit
    "0xa415bcad", // borrow
    "0x573ade81", // repay
    "0x69328dec", // withdraw
  ],
  TRANSFER: [
    "0xa9059cbb", // transfer
    "0x23b872dd", // transferFrom
  ],
};

// Known bridge contracts
const BRIDGE_CONTRACTS = new Set([
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf", // Polygon Bridge
  "0xa0c68c638235ee32657e8f720a23cec1bfc77c77", // Arbitrum Bridge
  "0x3ee18b2214aff97000d974cf647e7c347e8fa585", // Wormhole Bridge
  "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", // Optimism Bridge
]);

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
    this.knownProtocols.set(
      "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9",
      "AAVE V2"
    );
    this.knownProtocols.set(
      "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
      "Curve"
    );
  }

  async analyzeTransaction(
    tx: ethers.TransactionResponse
  ): Promise<TransactionDetails> {
    try {
      if (!tx.to) return { type: "unknown" };

      const result: TransactionDetails = {
        protocol: this.knownProtocols.get(tx.to.toLowerCase()),
        value: tx.value.toString(),
      };

      // Try to decode the transaction
      const abi = await this.getContractABI(tx.to);
      if (abi) {
        try {
          const iface = new ethers.Interface(abi);
          const decoded = iface.parseTransaction({
            data: tx.data,
            value: tx.value,
          });
          if (decoded) {
            result.methodName = decoded.name;
            result.params = decoded.args;
          }
        } catch (e) {
          // If we can't decode with full ABI, try to decode just the function signature
          const signature = tx.data.slice(0, 10);
          const methodName = await this.getFunctionSignature(signature);
          if (methodName) {
            result.methodName = methodName;
          }
        }
      }

      // Determine transaction type
      result.type = this.determineTransactionType(tx, result.methodName);

      // Check for potential sandwich patterns
      const sandwichInfo = await this.detectSandwichPattern(tx);
      if (sandwichInfo.isSandwich) {
        result.type = "sandwich";
        result.isSandwichTarget = sandwichInfo.isTarget;
      }

      // Add more context for transfers
      if (result.type === "transfer" && result.params) {
        try {
          const [recipient, amount] = result.params;
          result.category = "erc20";
          result.params = {
            recipient,
            amount: amount.toString(),
            token: tx.to,
          };
        } catch (e) {
          // Keep original params if parsing fails
        }
      }

      return result;
    } catch (error) {
      this.logger.error("Error analyzing transaction:", error);
      return { type: "unknown" };
    }
  }

  private determineTransactionType(
    tx: ethers.TransactionResponse,
    methodName?: string
  ): TransactionDetails["type"] {
    const signature = tx.data.slice(0, 10).toLowerCase();

    // Check if it's a bridge transaction
    if (tx.to && BRIDGE_CONTRACTS.has(tx.to.toLowerCase())) {
      return "bridge";
    }

    // Check method signatures
    if (METHOD_SIGNATURES.SWAP.includes(signature)) {
      return "swap";
    }
    if (METHOD_SIGNATURES.LIQUIDITY.includes(signature)) {
      return "liquidity";
    }
    if (METHOD_SIGNATURES.LENDING.includes(signature)) {
      return "lending";
    }
    if (METHOD_SIGNATURES.TRANSFER.includes(signature)) {
      return "transfer";
    }

    // Check method names if available
    if (methodName) {
      const lowerMethod = methodName.toLowerCase();
      if (lowerMethod.includes("swap")) return "swap";
      if (lowerMethod.includes("liquidity") || lowerMethod.includes("pool"))
        return "liquidity";
      if (
        lowerMethod.includes("borrow") ||
        lowerMethod.includes("lend") ||
        lowerMethod.includes("repay") ||
        lowerMethod.includes("deposit")
      )
        return "lending";
      if (lowerMethod.includes("bridge")) return "bridge";
      if (lowerMethod === "transfer" || lowerMethod === "transferFrom")
        return "transfer";
    }

    // Check if it's a simple ETH transfer
    if (tx.data === "0x" && tx.value > BigInt(0)) {
      return "transfer";
    }

    return "unknown";
  }

  private async getContractABI(address: string): Promise<string[] | null> {
    address = address.toLowerCase();

    // Check cache first
    if (this.abiCache.has(address)) {
      return this.abiCache.get(address);
    }

    // Check common ABIs
    if (COMMON_ABIS[address]) {
      this.abiCache.set(address, COMMON_ABIS[address]);
      return COMMON_ABIS[address];
    }

    try {
      // Try Sourcify first (doesn't require API key)
      const sourcifyUrl = `https://sourcify.dev/server/repository/contracts/full_match/1/${address}/metadata.json`;
      const response = await axios.get(sourcifyUrl);
      if (response.data?.output?.abi) {
        this.abiCache.set(address, response.data.output.abi);
        return response.data.output.abi;
      }
    } catch (error) {
      // Sourcify miss, try Etherscan if API key is available
      if (process.env.ETHERSCAN_API_KEY) {
        try {
          const response = await axios.get(`https://api.etherscan.io/api`, {
            params: {
              module: "contract",
              action: "getabi",
              address: address,
              apikey: process.env.ETHERSCAN_API_KEY,
            },
          });

          if (response.data.status === "1") {
            const abi = JSON.parse(response.data.result);
            this.abiCache.set(address, abi);
            return abi;
          }
        } catch (error) {
          // Ignore Etherscan errors
        }
      }
    }

    // Cache miss
    this.abiCache.set(address, null);
    return null;
  }

  private async getFunctionSignature(
    signature: string
  ): Promise<string | null> {
    try {
      // Try 4byte.directory
      const response = await axios.get(
        `https://www.4byte.directory/api/v1/signatures/?hex_signature=${signature}`
      );
      if (response.data?.results?.length > 0) {
        return response.data.results[0].text_signature;
      }
    } catch (error) {
      // Ignore 4byte.directory errors
    }
    return null;
  }

  private async detectSandwichPattern(
    tx: ethers.TransactionResponse
  ): Promise<SandwichInfo> {
    const isSwap = this.isSwapTransaction(tx);
    if (!isSwap) return { isSandwich: false, isTarget: false };

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
          return { isSandwich: true, isTarget: true };
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
            return { isSandwich: true, isTarget: false };
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

    return { isSandwich: false, isTarget: false };
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
    return tx.data.includes(token.slice(2).toLowerCase());
  }

  private getAffectedToken(tx: ethers.TransactionResponse): string | null {
    try {
      // Extract token address from swap data
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
