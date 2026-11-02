import { DatabaseSync } from "node:sqlite";
import { basename } from "node:path";

const file = process.argv[2];
if (!process.send || !file || basename(file) !== "main.sqlite")
	throw new Error("Requires fixture IPC and database");
process.on("message", () => {});
const database = new DatabaseSync(file);
database.exec("PRAGMA journal_mode = DELETE; PRAGMA application_id = 7");
database.exec("CREATE TABLE fixture_foreign (value BLOB)");
const insert = database.prepare("INSERT INTO fixture_foreign VALUES (zeroblob(4096))");
for (let i = 0; i < 64; i++) insert.run();
database.exec("PRAGMA cache_size = 3; BEGIN IMMEDIATE; UPDATE fixture_foreign SET value = zeroblob(8192)");
process.send({ ready: true });
