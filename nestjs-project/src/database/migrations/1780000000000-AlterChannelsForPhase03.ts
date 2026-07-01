import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterChannelsForPhase031780000000000 implements MigrationInterface {
  name = 'AlterChannelsForPhase031780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop OneToOne enforcement constraint
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "REL_23dc7937150c9567d37869313c"`,
    );
    // Drop UNIQUE constraint on user_id (allow many channels per user)
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_23dc7937150c9567d37869313ce"`,
    );
    // Drop UNIQUE constraint on nickname column
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_a221f571edb63f68938f1bdd969"`,
    );
    // Rename nickname → slug
    await queryRunner.query(
      `ALTER TABLE "channels" RENAME COLUMN "nickname" TO "slug"`,
    );
    // Expand name from varchar(50) to varchar(255)
    await queryRunner.query(
      `ALTER TABLE "channels" ALTER COLUMN "name" TYPE character varying(255)`,
    );
    // Expand slug (formerly nickname) from varchar(50) to varchar(255)
    await queryRunner.query(
      `ALTER TABLE "channels" ALTER COLUMN "slug" TYPE character varying(255)`,
    );
    // Add unique constraint on slug
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_channels_slug" UNIQUE ("slug")`,
    );
    // Drop obsolete columns
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "updated_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add updated_at
    await queryRunner.query(
      `ALTER TABLE "channels" ADD COLUMN "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    // Re-add description
    await queryRunner.query(
      `ALTER TABLE "channels" ADD COLUMN "description" text`,
    );
    // Drop slug unique constraint
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_channels_slug"`,
    );
    // Shrink slug back to varchar(50)
    await queryRunner.query(
      `ALTER TABLE "channels" ALTER COLUMN "slug" TYPE character varying(50)`,
    );
    // Shrink name back to varchar(50)
    await queryRunner.query(
      `ALTER TABLE "channels" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    // Rename slug → nickname
    await queryRunner.query(
      `ALTER TABLE "channels" RENAME COLUMN "slug" TO "nickname"`,
    );
    // Re-add UNIQUE constraint on nickname
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_a221f571edb63f68938f1bdd969" UNIQUE ("nickname")`,
    );
    // Re-add UNIQUE constraint on user_id
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_23dc7937150c9567d37869313ce" UNIQUE ("user_id")`,
    );
    // Re-add OneToOne enforcement constraint
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "REL_23dc7937150c9567d37869313c" UNIQUE ("user_id")`,
    );
  }
}
