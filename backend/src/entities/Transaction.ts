import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
} from "typeorm";
import { Block } from "./Block";

export enum TransactionStatus {
  PENDING = "pending",
  INCLUDED = "included",
  FAILED = "failed",
}

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @Index({ unique: true })
  hash!: string;

  @Column()
  @Index()
  from!: string;

  @Column({ nullable: true })
  @Index()
  to?: string;

  @Column("numeric", { precision: 40, scale: 0 })
  value!: string;

  @Column("numeric", { precision: 20, scale: 0 })
  gasLimit!: string;

  @Column("numeric", { precision: 20, scale: 0, nullable: true })
  maxFeePerGas?: string;

  @Column("numeric", { precision: 20, scale: 0, nullable: true })
  maxPriorityFeePerGas?: string;

  @Column("numeric", { precision: 20, scale: 0, nullable: true })
  gasPrice?: string;

  @Column("text")
  data!: string;

  @Column("int", { nullable: true })
  nonce?: number;

  @Column({
    type: "enum",
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  @Index()
  status!: TransactionStatus;

  @Column({ nullable: true })
  @Index()
  blockHash?: string;

  @Column({ nullable: true })
  @Index()
  blockNumber?: number;

  @ManyToOne(() => Block, (block) => block.transactions)
  block?: Block;

  @Column({ nullable: true })
  transactionIndex?: number;

  @CreateDateColumn()
  @Index()
  firstSeen!: Date;

  @Column({ nullable: true })
  includedAt?: Date;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, any>;

  @Column("jsonb", { nullable: true })
  decodedData?: Record<string, any>;
}
