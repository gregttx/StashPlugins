// A plugin's version now lives in three files: the manifest, the yml, and a
// PLUGIN_VERSION constant inside the script itself. The constant exists because it
// is the only one that proves which code is running - the other two are read by
// Stash over GraphQL and are current the moment plugins are reloaded, whether or not
// the browser has fetched the new script - and it is worth nothing if it can drift
// from the release it claims to be, or if it never reaches the console.
//
// So this suite loads each plugin for real and reads what it printed, rather than
// grepping for a console call: the shape of the call is not the point, the line
// arriving at load is.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const PLUGINS = ['NormalizeParentTags', 'MergePerformerTagsToScenes'];

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// `version: 1.2.3`, from a yml or from the manifest, which is yml too.
function declared(text) {
  const m = /^version:\s*(\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

// Loads the plugin into a fresh context whose console records everything, and
// returns the lines it printed before anything else happened.
function load(name) {
  const lines = [];
  const env = h.makeEnv({ quiet: true, respond: () => ({ data: {} }) });
  const record = (m) => lines.push(String(m));
  env.ctx.console = { info: record, log: record, warn() {}, error() {} };
  h.run(env.ctx, path.join(__dirname, '..', name, name + '.js'));
  return lines;
}

PLUGINS.forEach((name) => {
  const manifest = declared(read(name, 'manifest'));
  const yml = declared(read(name, name + '.yml'));

  h.check(name + ' declares a version in its yml and manifest', !!manifest && !!yml,
    yml + ' / ' + manifest);
  h.check(name + ' has the same version in both', yml === manifest,
    'yml ' + yml + ' / manifest ' + manifest);

  const banner = load(name).filter((l) => l.indexOf(name + '.js') !== -1);
  h.check(name + ' announces itself at load', banner.length === 1, banner.join(' | '));

  const line = banner[0] || '';
  h.check(name + ' announces the version its manifest declares',
    line.indexOf(name + '.js ' + manifest + ' loaded') !== -1, line);
  // Without this the line is just one more version to disbelieve alongside the one
  // on the settings page - the value is in saying which of the two can be trusted.
  h.check(name + ' says the number is the script own, not the manifest',
    /manifest/.test(line), line);
});

h.finish();
