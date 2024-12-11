import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";
import type { BlockComparison as IBlockComparison } from "@shared/types";

@Entity()
export class BlockComparison implements IBlockComparison {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  blockNumber!: number;

  @Column("text", { array: true })
  predictedTransactions!: string[];

  @Column("text", { array: true })
  actualTransactions!: string[];

  @Column("float")
  accuracy!: number;

  @Column()
  miner!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column("float", { nullable: true })
  averageGasPrice?: number;
}
