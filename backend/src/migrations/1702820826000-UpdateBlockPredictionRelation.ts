import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateBlockPredictionRelation1702820826000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "block_prediction" DROP CONSTRAINT "FK_b745d9c87ef05120807ea7ed69a"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "block_prediction" ADD CONSTRAINT "FK_b745d9c87ef05120807ea7ed69a" FOREIGN KEY ("blockNumber") REFERENCES "block"("number")`
    );
  }
}
