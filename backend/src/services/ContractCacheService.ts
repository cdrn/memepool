import { DataSource, Repository } from "typeorm";
import { ContractCache } from "../entities/ContractCache";
import axios from "axios";
import { ethers } from "ethers";
import { Not, IsNull } from "typeorm";
import { createComponentLogger } from "../utils/logger";

export class ContractCacheService {
  private repository: Repository<ContractCache>;
  private logger = createComponentLogger("ContractCacheService");
  private provider: ethers.Provider;

  constructor(db: DataSource, provider: ethers.Provider) {
    this.repository = db.getRepository(ContractCache);
    this.provider = provider;
  }

  async getContractData(address: string): Promise<ContractCache | null> {
    address = address.toLowerCase();

    try {
      // Try to find existing contract
      let contract = await this.repository.findOne({ where: { address } });

      if (contract) {
        // If we've already tried fetching or the contract is verified, just update call count and return
        if (contract.fetchAttempted || contract.verified) {
          await this.repository.increment({ address }, "callCount", 1);
          contract.callCount++; // Update local instance
          return contract;
        }
      }

      // If not in database or haven't attempted fetch yet, try external sources
      let abi = null;
      let contractName = null;
      let source = null;
      let verified = false;

      // Try Sourcify first
      const sourcifyData = await this.fetchFromSourcify(address);
      if (sourcifyData) {
        abi = sourcifyData.abi;
        contractName = sourcifyData.name;
        source = sourcifyData.source;
        verified = true;
      } else if (process.env.ETHERSCAN_API_KEY) {
        // Try Etherscan if Sourcify fails
        const etherscanData = await this.fetchFromEtherscan(address);
        if (etherscanData) {
          abi = etherscanData.abi;
          contractName = etherscanData.name;
          source = etherscanData.source;
          verified = true;
        }
      }

      // Use upsert to handle potential race conditions
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .into(ContractCache)
        .values({
          address,
          abi,
          contractName,
          source,
          verified,
          fetchAttempted: true, // Mark that we've attempted to fetch
          callCount: 1,
        })
        .orUpdate(
          [
            "abi",
            "contractName",
            "source",
            "verified",
            "fetchAttempted",
            "callCount",
          ],
          ["address"],
          {
            skipUpdateIfNoValuesChanged: true,
          }
        )
        .execute();

      // Return the newly created/updated contract
      return await this.repository.findOne({ where: { address } });
    } catch (error) {
      this.logger.error("Error in getContractData:", { address, error });
      return null;
    }
  }

  async getFunctionSignature(signature: string): Promise<string | null> {
    // Check all cached contracts first
    const contracts = await this.repository.find({
      where: {
        functionSignatures: Not(IsNull()),
      },
    });

    // Check each contract's function signatures
    for (const contract of contracts) {
      if (
        contract.functionSignatures &&
        signature in contract.functionSignatures
      ) {
        return contract.functionSignatures[signature];
      }
    }

    try {
      // Try 4byte.directory
      const response = await axios.get(
        `https://www.4byte.directory/api/v1/signatures/?hex_signature=${signature}`
      );

      if (response.data?.results?.length > 0) {
        const textSignature = response.data.results[0].text_signature;

        // Store in database for future use
        const contract =
          (await this.repository.findOne({
            where: { address: "0x4byte_directory" },
          })) || new ContractCache();

        contract.address = "0x4byte_directory";
        contract.functionSignatures = {
          ...(contract.functionSignatures || {}),
          [signature]: textSignature,
        };

        await this.repository.save(contract);
        return textSignature;
      }
    } catch (error) {
      this.logger.error("Error fetching function signature:", {
        signature,
        error,
      });
    }

    return null;
  }

  private async fetchFromSourcify(address: string) {
    try {
      const response = await axios.get(
        `https://sourcify.dev/server/repository/contracts/full_match/1/${address}/metadata.json`
      );

      if (response.data?.output?.abi) {
        return {
          abi: response.data.output.abi,
          name: response.data.output.name,
          source:
            response.data.sources?.[Object.keys(response.data.sources)[0]]
              ?.content,
        };
      }
    } catch (error) {
      // Ignore Sourcify errors
    }
    return null;
  }

  private async fetchFromEtherscan(address: string) {
    try {
      const [abiResponse, sourceResponse] = await Promise.all([
        axios.get(`https://api.etherscan.io/api`, {
          params: {
            module: "contract",
            action: "getabi",
            address: address,
            apikey: process.env.ETHERSCAN_API_KEY,
          },
        }),
        axios.get(`https://api.etherscan.io/api`, {
          params: {
            module: "contract",
            action: "getsourcecode",
            address: address,
            apikey: process.env.ETHERSCAN_API_KEY,
          },
        }),
      ]);

      if (
        abiResponse.data.status === "1" &&
        sourceResponse.data.status === "1"
      ) {
        const abi = JSON.parse(abiResponse.data.result);
        const sourceInfo = sourceResponse.data.result[0];

        return {
          abi,
          name: sourceInfo.ContractName,
          source: sourceInfo.SourceCode,
        };
      }
    } catch (error) {
      // Ignore Etherscan errors
    }
    return null;
  }

  async updateProtocolInfo(address: string, protocol: string, type: string) {
    address = address.toLowerCase();
    let contract = await this.repository.findOne({ where: { address } });

    if (!contract) {
      contract = new ContractCache();
      contract.address = address;
    }

    contract.protocol = protocol;
    contract.type = type;
    await this.repository.save(contract);
  }
}
