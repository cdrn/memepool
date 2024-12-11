import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";
import type { BlockPrediction as IBlockPrediction } from "@shared/types";

@Entity()
export class BlockPrediction implements IBlockPrediction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  blockNumber!: number;

  @Column("text", { array: true })
  predictedTransactions!: string[];

  @Column("float")
  predictedGasPrice!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
