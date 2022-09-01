'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

const build = require('./chunks/build.cjs');
require('child_process');
require('crypto');
require('fs-extra');
require('jsdom');
require('kolorist');
require('module');
require('p-queue');
require('path');
require('vite');



exports.build = build.build;
