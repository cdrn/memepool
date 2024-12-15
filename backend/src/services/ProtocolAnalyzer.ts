import { ethers } from "ethers";
import axios from "axios";
import { Logger } from "winston";
import { ContractCacheService } from "./ContractCacheService";
import { DataSource } from "typeorm";

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
  // Uniswap V3 Routers
  "0xe592427a0aece92de3edee1f18e0157c05861564": [
    "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
    "function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)",
  ],
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": [
    "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
    "function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)",
  ],
  // AAVE V2 & V3
  "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9": [
    "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
    "function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256)",
    "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  ],
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": [
    // AAVE V3 Pool
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
  ],
  // Curve Pools
  "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7": [
    // 3pool
    "function add_liquidity(uint256[3] memory amounts, uint256 min_mint_amount) external",
    "function remove_liquidity(uint256 _amount, uint256[3] memory min_amounts) external",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external",
  ],
  "0xdc24316b9ae028f1497c275eb9192a3ea0f67022": [
    // stETH pool
    "function add_liquidity(uint256[2] memory amounts, uint256 min_mint_amount) external",
    "function remove_liquidity(uint256 _amount, uint256[2] memory min_amounts) external",
  ],
  "0xd51a44d3fae010294c616388b506acda1bfaae46": [
    // Tricrypto2
    "function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external",
    "function add_liquidity(uint256[3] memory amounts, uint256 min_mint_amount) external",
  ],
  // Balancer
  "0xba12222222228d8ba445958a75a0704d566bf2c8": [
    // Vault
    "function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) request) external returns (uint256)",
    "function joinPool(bytes32 poolId, address sender, address recipient, tuple(address[] assets, uint256[] maxAmountsIn, bytes userData, bool fromInternalBalance) request) external",
    "function exitPool(bytes32 poolId, address sender, address recipient, tuple(address[] assets, uint256[] minAmountsOut, bytes userData, bool toInternalBalance) request) external",
  ],
  // Lido
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": [
    // stETH
    "function submit(address referral) external payable returns (uint256)",
    "function withdraw(uint256 amount, bytes32 pubkeyHash) external",
  ],
  // Compound
  "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b": [
    // Comptroller
    "function enterMarkets(address[] calldata cTokens) returns (uint[] memory)",
    "function exitMarket(address cToken) returns (uint)",
  ],
  // 1inch
  "0x1111111254eeb25477b68fb85ed929f73a960582": [
    // Router
    "function swap(address caller, tuple(address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) external returns (uint256 returnAmount)",
  ],
  // Chainlink
  "0x47fb2585d2c5dacb4c659f2488d": [
    // Price Feeds
    "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ],
  // OpenSea
  "0x00000000006c3852cbef3e08e8df289169ede581": [
    // Seaport
    "function fulfillBasicOrder(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) external payable returns (bool fulfilled)",
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
  private contractCache: ContractCacheService;
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

  constructor(provider: ethers.Provider, logger: Logger, db: DataSource) {
    this.provider = provider;
    this.logger = logger;
    this.contractCache = new ContractCacheService(db, logger, provider);
    this.initializeKnownProtocols();
  }

  private initializeKnownProtocols() {
    // Initialize known protocols
    Object.entries(COMMON_ABIS).forEach(([address, _]) => {
      const protocol = this.categorizeContract(address);
      if (protocol) {
        this.knownProtocols.set(address.toLowerCase(), protocol);
        // Update cache with protocol info
        this.contractCache.updateProtocolInfo(
          address,
          protocol,
          this.categorizeContractType(protocol)
        );
      }
    });
  }

  private categorizeContractType(protocol: string): string {
    if (
      protocol.includes("Uniswap") ||
      protocol.includes("SushiSwap") ||
      protocol.includes("1inch")
    ) {
      return "dex";
    }
    if (protocol.includes("AAVE") || protocol.includes("Compound")) {
      return "lending";
    }
    if (protocol.includes("Bridge")) {
      return "bridge";
    }
    if (protocol.includes("Curve")) {
      return "amm";
    }
    if (protocol.includes("Chainlink")) {
      return "oracle";
    }
    return "unknown";
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

      // If still unknown, try to identify contract type from Etherscan
      if (!result.protocol && process.env.ETHERSCAN_API_KEY) {
        try {
          const response = await axios.get(`https://api.etherscan.io/api`, {
            params: {
              module: "contract",
              action: "getsourcecode",
              address: tx.to,
              apikey: process.env.ETHERSCAN_API_KEY,
            },
          });

          if (response.data.status === "1" && response.data.result[0]) {
            const contractName = response.data.result[0].ContractName;
            if (contractName) {
              // Add to known protocols for future use
              this.knownProtocols.set(
                tx.to.toLowerCase(),
                this.categorizeContract(contractName)
              );
              result.protocol = this.knownProtocols.get(tx.to.toLowerCase());
            }
          }
        } catch (error) {
          // Ignore Etherscan errors
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
          result.category = await this.detectTokenType(tx.to);
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

    // Check memory cache first
    if (this.abiCache.has(address)) {
      return this.abiCache.get(address);
    }

    // Check database cache
    const contractData = await this.contractCache.getContractData(address);
    if (contractData?.abi) {
      this.abiCache.set(address, contractData.abi);
      return contractData.abi;
    }

    // Check common ABIs
    if (COMMON_ABIS[address]) {
      this.abiCache.set(address, COMMON_ABIS[address]);
      return COMMON_ABIS[address];
    }

    return null;
  }

  private async getFunctionSignature(
    signature: string
  ): Promise<string | null> {
    return await this.contractCache.getFunctionSignature(signature);
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

  private categorizeContract(contractName: string): string {
    const lowerName = contractName.toLowerCase();
    if (lowerName.includes("swap") || lowerName.includes("amm")) return "DEX";
    if (lowerName.includes("pool")) return "Liquidity Pool";
    if (lowerName.includes("bridge")) return "Bridge";
    if (lowerName.includes("vault")) return "Vault";
    if (lowerName.includes("lending") || lowerName.includes("borrow"))
      return "Lending Protocol";
    if (lowerName.includes("oracle")) return "Oracle";
    if (lowerName.includes("token")) return "Token Contract";
    return contractName;
  }

  private async detectTokenType(address: string): Promise<string> {
    try {
      // Try to detect if it's an ERC20/721/1155
      const iface = new ethers.Interface([
        "function supportsInterface(bytes4 interfaceId) external view returns (bool)",
      ]);
      const contract = new ethers.Contract(address, iface, this.provider);

      // ERC721 interface ID
      const isERC721 = await contract
        .supportsInterface("0x80ac58cd")
        .catch(() => false);
      if (isERC721) return "erc721";

      // ERC1155 interface ID
      const isERC1155 = await contract
        .supportsInterface("0xd9b67a26")
        .catch(() => false);
      if (isERC1155) return "erc1155";

      // If neither, assume ERC20
      return "erc20";
    } catch (e) {
      return "unknown";
    }
  }
}
