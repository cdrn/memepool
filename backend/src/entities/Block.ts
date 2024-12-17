import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { Transaction } from "./Transaction";
import { BlockPrediction } from "./BlockPrediction";

@Entity()
export class Block {
  @PrimaryColumn()
  number!: number;

  @Column()
  @Index()
  hash!: string;

  @Column()
  parentHash!: string;

  @Column()
  @Index()
  timestamp!: Date;

  @Column()
  @Index()
  miner!: string;

  @Column({ nullable: true })
  builder?: string;

  @Column({ nullable: true })
  builderName?: string;

  @Column("text")
  extraData!: string;

  @Column("numeric", { precision: 20, scale: 0 })
  gasLimit!: string;

  @Column("numeric", { precision: 20, scale: 0 })
  gasUsed!: string;

  @Column("numeric", { precision: 20, scale: 0, nullable: true })
  baseFeePerGas?: string;

  @Column("simple-array")
  transactionHashes!: string[];

  @OneToMany(
    (type) => Transaction,
    (transaction: Transaction) => transaction.block
  )
  transactions!: Transaction[];

  @OneToMany(
    (type) => BlockPrediction,
    (prediction: BlockPrediction) => prediction.block
  )
  predictions!: BlockPrediction[];

  @CreateDateColumn()
  createdAt!: Date;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, any>;
}
