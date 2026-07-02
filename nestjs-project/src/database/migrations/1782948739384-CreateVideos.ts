import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1782948739384 implements MigrationInterface {
  name = 'CreateVideos1782948739384';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_f9fe0463a9fa4899f41ab736511"`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "file_key"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "duration"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "size"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "mime_type"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "visibility"`);
    await queryRunner.query(`DROP TYPE "public"."videos_visibility_enum"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "views"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "published_at"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "category_id"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "likes_count"`);
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "dislikes_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "comments_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "upload_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "storage_key" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "duration_seconds" double precision`,
    );
    await queryRunner.query(`ALTER TABLE "videos" ADD "metadata" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "title" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."videos_status_enum" RENAME TO "videos_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" TYPE "public"."videos_status_enum" USING "status"::"text"::"public"."videos_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum_old"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "thumbnail_key"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "thumbnail_key" character varying(500)`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ece1558efc6efd53eb530479db" ON "videos" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ece1558efc6efd53eb530479db"`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "thumbnail_key"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "thumbnail_key" character varying`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum_old" AS ENUM('UPLOADING', 'PROCESSING', 'DRAFT', 'READY', 'FAILED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" TYPE "public"."videos_status_enum_old" USING "status"::"text"::"public"."videos_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'UPLOADING'`,
    );
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."videos_status_enum_old" RENAME TO "videos_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "title" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "metadata"`);
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "duration_seconds"`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "storage_key"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "upload_id"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "comments_count" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "dislikes_count" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "likes_count" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "videos" ADD "category_id" integer`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "published_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "views" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_visibility_enum" AS ENUM('PUBLIC', 'UNLISTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "visibility" "public"."videos_visibility_enum" NOT NULL DEFAULT 'PUBLIC'`,
    );
    await queryRunner.query(`ALTER TABLE "videos" ADD "description" text`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "mime_type" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "videos" ADD "size" bigint`);
    await queryRunner.query(`ALTER TABLE "videos" ADD "duration" real`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "file_key" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_f9fe0463a9fa4899f41ab736511" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
