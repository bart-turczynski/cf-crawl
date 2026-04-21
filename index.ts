#!/usr/bin/env node
import "dotenv/config";
import { main } from "./src/cli.js";
import { ConfigError, UsageError } from "./src/errors.js";

main().catch((err: Error & { errors?: unknown[] }) => {
  if (err instanceof UsageError || err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }

  console.error(`\n${err.name ?? "Error"}: ${err.message}`);
  if (err.errors) console.error("Details:", JSON.stringify(err.errors, null, 2));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
