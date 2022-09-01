import { gray, bold, red, reset } from 'kolorist';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { b as build } from '../chunks/build.mjs';
import 'child_process';
import 'crypto';
import 'fs-extra';
import 'jsdom';
import 'module';
import 'p-queue';
import 'path';
import 'vite';

yargs(hideBin(process.argv)).scriptName("vite-ssg").usage("$0 [args]").command(
  "build",
  "Build SSG",
  (args) => args.option("script", {
    choices: ["sync", "async", "defer", "async defer"],
    describe: "Rewrites script loading timing"
  }).option("mock", {
    type: "boolean",
    describe: "Mock browser globals (window, document, etc.) for SSG"
  }),
  async (args) => {
    await build(args);
  }
).fail((msg, err, yargs2) => {
  console.error(`
${gray("[vite-ssg]")} ${bold(red("An internal error occurred."))}`);
  console.error(`${gray("[vite-ssg]")} ${reset("Something's fucked")}`);
  yargs2.exit(1, err);
}).showHelpOnFail(false).help().argv;
