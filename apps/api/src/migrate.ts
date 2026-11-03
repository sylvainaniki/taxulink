import { connect, migrate } from "./db";
async function main() {
  const db = await connect(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log("Migrations applied");
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
