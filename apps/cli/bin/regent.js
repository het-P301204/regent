#!/usr/bin/env node
import { main } from "../src/main.ts"
process.exitCode = main(process.argv.slice(2)) ?? 0
