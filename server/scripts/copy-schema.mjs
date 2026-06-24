// Cross-platform replacement for `cp src/db/schema.sql dist/db/schema.sql`. Windows has no
// `cp`. tsc ignores non-TS files, so the runtime SQL schema must be copied into dist/ after
// the compile. Runs with cwd = server/ (npm run build --workspace=server).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dest = "dist/db/schema.sql";
mkdirSync(dirname(dest), { recursive: true });
copyFileSync("src/db/schema.sql", dest);
