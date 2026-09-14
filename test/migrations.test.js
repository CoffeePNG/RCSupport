const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {migrateDatabase}=require('../dist/db/migrations');
function adapter(raw) {
  return {exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>()=>{
    raw.exec('BEGIN');try{fn();raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}
  }};
}
test('extracted migrations preserve old task data and remain safe to run again',()=>{
  const raw=new DatabaseSync(':memory:');
  try {
    raw.exec(`CREATE TABLE todos(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT NOT NULL,
      content TEXT NOT NULL,assignee_id TEXT,created_by TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,completed_at INTEGER,completed_by TEXT);
      INSERT INTO todos(guild_id,content,created_by,created_at) VALUES('guild','Old task','staff',1234);`);
    migrateDatabase(adapter(raw));
    const before=raw.prepare('SELECT * FROM todos').all();
    assert.equal(before[0].title,'Old task');assert.equal(before[0].content,null);
    assert.equal(before[0].created_at,1234);assert.equal(before[0].id,1);
    migrateDatabase(adapter(raw));assert.deepEqual(raw.prepare('SELECT * FROM todos').all(),before);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM rcsupport_poll_state').get().n,1);
  } finally {raw.close();}
});
