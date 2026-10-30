import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('backup bundle restores JSON and external local assets with an explicit manifest', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'rcaas-backup-test-'));
  try {
    const data=path.join(root,'data'),assets=path.join(root,'scans'),backups=path.join(root,'backups'),restored=path.join(root,'restored');
    for(const d of [data,assets,restored])await mkdir(d);
    await writeFile(path.join(data,'record.json'),'{"test":true}');await writeFile(path.join(data,'.api.lock'),'123');await writeFile(path.join(assets,'scan.bin'),'scan-bytes');
    const result=spawnSync(process.execPath,['scripts/backup-data.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATA_DIR:data,ASSET_DIR:assets,BACKUP_DIR:backups,DATABASE_URL:'',ASSET_DRIVER:'local'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+result.stdout);
    const file=(await readdir(backups)).find((f)=>f.endsWith('.tar.gz'));
    const extract=(archive,target)=>assert.equal(spawnSync('tar',['-xzf',archive,'-C',target],{encoding:'utf8'}).status,0);
    extract(path.join(backups,file),restored);
    const manifest=JSON.parse(await readFile(path.join(restored,'manifest.json'),'utf8'));
    assert.equal(manifest.format,2);assert.deepEqual(manifest.components.map((c)=>c.target),['DATA_DIR','ASSET_DIR']);
    extract(path.join(restored,'data.tar.gz'),restored);extract(path.join(restored,'assets.tar.gz'),restored);
    assert.equal(await readFile(path.join(restored,'data/record.json'),'utf8'),'{"test":true}');
    assert.equal(await readFile(path.join(restored,'scans/scan.bin'),'utf8'),'scan-bytes');
    assert.ok(!(await readdir(path.join(restored,'data'))).includes('.api.lock'));
  } finally {await rm(root,{recursive:true,force:true});}
});
