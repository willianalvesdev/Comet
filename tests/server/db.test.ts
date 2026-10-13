import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';

test('PostgreSQL reconnects after an idle connection is lost without crashing the server', {timeout:15000}, async () => {
    const source = `
        import {Client} from 'pg';
        import database from './server/db.ts';
        const {query,closeDatabase}=database;
        const [{pid}]=await query('SELECT pg_backend_pid() AS pid');
        const independent=new Client({connectionString:process.env.DATABASE_URL});
        try {
            await independent.connect();
            await independent.query('SELECT pg_terminate_backend($1)',[pid]);
            await new Promise(resolve=>setTimeout(resolve,100));
            const [{value}]=await query('SELECT 42 AS value');
            if(value!==42)throw new Error('Connection did not recover');
        } finally {await independent.end();await closeDatabase();}
    `;
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',chunk=>{output+=String(chunk);});
    child.stderr.on('data',chunk=>{output+=String(chunk);});
    const deadline=setTimeout(()=>child.kill(),12000);
    try {
        const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
        assert.equal(code,0,output);
    } finally {clearTimeout(deadline);}
});
