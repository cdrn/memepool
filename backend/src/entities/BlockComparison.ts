import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";
import type { BlockComparison as IBlockComparison } from "@shared/types";

@Entity()
@Index(["blockNumber"], { unique: true })
export class BlockComparison implements IBlockComparison {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("bigint")
  blockNumber!: number;

  @Column("text", { array: true, default: [] })
  predictedTransactions!: string[];

  @Column("text", { array: true, default: [] })
  actualTransactions!: string[];

  @Column("decimal", { precision: 5, scale: 2, default: 0 })
  accuracy!: number;

  @Column("varchar", { length: 42 })
  miner!: string;

  @Column("varchar", { length: 42, nullable: true })
  builder?: string;

  @Column("varchar", { length: 255, nullable: true })
  builderName?: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column("decimal", { precision: 10, scale: 2, default: 0 })
  averageGasPrice!: number;
}
