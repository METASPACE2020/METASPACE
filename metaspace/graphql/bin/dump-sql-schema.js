require('ts-node/register');
const {default: typeOrmConfig, DbSchemaName} = require('../src/utils/typeOrmConfig');
const {createConnection} = require('typeorm');
const {promisify} = require('util');
const writeFile = promisify(require("fs").writeFile);

const run = async (outputFile) => {
  const config = {
    ...typeOrmConfig,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false
  };
  const rootConnection = await createConnection({...config});
  const rootQueryRunner = rootConnection.createQueryRunner();
  const database = 'graphql_typeorm_schema';
  try {
    // TypeORM doesn't currently have a way to dump an SQL schema without any database interaction[1],
    // so make a blank database for it to diff against.
    // [1] https://github.com/typeorm/typeorm/issues/3037
    await rootQueryRunner.query(`DROP DATABASE IF EXISTS ${database};`);
    await rootQueryRunner.query(`CREATE DATABASE ${database};`);
    await rootQueryRunner.createSchema(DbSchemaName, true);

    const connection = await createConnection({...config, database, name: 'schema_db'});
    const sqlInMemory = await connection.driver.createSchemaBuilder().log();
    await connection.close();

    const sql = sqlInMemory.upQueries.map(q => q + ';\n\n').join('');
    const content =
`-- This file is autogenerated. Do not edit it directly.
-- To regenerate this file, run 'yarn run gen-sql-schema' in the graphql project

CREATE EXTENSION "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS graphql;

${sql}
`;

    await writeFile(outputFile, content);
  } finally {
    await rootQueryRunner.query(`DROP DATABASE IF EXISTS ${database};`);
    await rootConnection.close();
  }
};

if (process.argv.length !== 3) {
  throw 'Run this script with just 1 argument: the output file path';
} else {
  run(process.argv[2]).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
