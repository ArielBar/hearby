import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePoisTable1716000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pois" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "city" varchar NOT NULL,
        "geometry" geometry(Point, 4326) NOT NULL,
        "wikipediaUrl" varchar,
        "description" text NOT NULL,
        "language" varchar(2) NOT NULL,
        "rating" float
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pois_city" ON "pois" ("city");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pois_geometry" ON "pois" USING GIST ("geometry");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pois";`);
  }
}
