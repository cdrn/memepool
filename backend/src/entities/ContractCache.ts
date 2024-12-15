import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class ContractCache {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column()
  address!: string;

  @Column("jsonb", { nullable: true })
  abi?: any;

  @Column("text", { nullable: true })
  contractName?: string;

  @Column("text", { nullable: true })
  source?: string;

  @Column("jsonb", { nullable: true })
  functionSignatures?: { [signature: string]: string };

  @Column("text", { nullable: true })
  protocol?: string;

  @Column("text", { nullable: true })
  type?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column("boolean", { default: false })
  verified!: boolean;

  @Column("boolean", { default: false })
  fetchAttempted!: boolean;

  @Column("integer", { default: 0 })
  callCount!: number;
}
