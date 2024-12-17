import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
} from "typeorm";
import { Block } from "./Block";

@Entity()
export class BlockPrediction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @Index()
  blockNumber!: number;

  @ManyToOne(() => Block, (block) => block.predictions, { nullable: true })
  block?: Block;

  @Column("simple-array")
  predictedTransactions!: string[];

  @Column("numeric", { precision: 20, scale: 9 })
  predictedGasPrice!: string;

  @Column("jsonb")
  transactionDetails!: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;

  @Column("float", { nullable: true })
  accuracy?: number;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, any>;
}
