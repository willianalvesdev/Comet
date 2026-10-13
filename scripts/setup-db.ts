import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transaction, closeDatabase } from '../server/db';

async function main() {
    const schema = await readFile(resolve('setup_banco.sql'), 'utf8');
    await transaction(async db => {
        await db.query("SELECT pg_advisory_xact_lock(hashtext('comet-schema'))");
        await db.query(schema);
    });
    console.log('PostgreSQL preparado. As tabelas estão prontas e os dados existentes foram preservados.');
}
main().catch(error => {
    console.error('Não foi possível preparar o PostgreSQL:', error.code || error.message);
    process.exitCode = 1;
}).finally(closeDatabase);
