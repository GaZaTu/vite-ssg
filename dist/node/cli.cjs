'use strict';

const kolorist = require('kolorist');
const yargs = require('yargs');
const helpers = require('yargs/helpers');
const build = require('../chunks/build.cjs');
require('child_process');
require('crypto');
require('fs-extra');
require('jsdom');
require('module');
require('p-queue');
require('path');
require('vite');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e["default"] : e; }

const yargs__default = /*#__PURE__*/_interopDefaultLegacy(yargs);

yargs__default(helpers.hideBin(process.argv)).scriptName("vite-ssg").usage("$0 [args]").command(
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
    await build.build(args);
  }
).fail((msg, err, yargs2) => {
  console.error(`
${kolorist.gray("[vite-ssg]")} ${kolorist.bold(kolorist.red("An internal error occurred."))}`);
  console.error(`${kolorist.gray("[vite-ssg]")} ${kolorist.reset("Something's fucked")}`);
  yargs2.exit(1, err);
}).showHelpOnFail(false).help().argv;