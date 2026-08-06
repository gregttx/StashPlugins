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

const PLUGINS = ['NormalizeParentTags', 'MergePerformerTagsToScenes',
  'PropagateTagsAndPerformers'];

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// `version: 1.2.3`, from a yml or from the manifest, which is yml too.
function declared(text) {
  const m = /^version:\s*(\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

const yaml_url = (text) => (/^url:\s*"([^"]+)"\s*$/m.exec(text) || [])[1] || null;
const declaredDescription = (text) => (/^\s*description:\s*"(.*)"\s*$/m.exec(text) || [])[1] || null;

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

  // The README link is in three places too: `url:` for the chain icon Stash renders,
  // the head of the description, and README_URL in the script that injects the
  // labelled link. All three must be the same pinned revision.
  const yml_url = yaml_url(read(name, name + '.yml'));
  const js_url = (/var README_URL = '([^']+)'/.exec(read(name, name + '.js')) || [])[1];
  h.check(name + ' links its README from the manifest url field', !!yml_url, String(yml_url));
  h.check(name + ' injects the same URL from the script', js_url === yml_url,
    'script ' + js_url + ' / yml ' + yml_url);
  // Deliberately *not* in the description: Stash renders that as plain text, so a
  // URL there is unclickable noise in front of every word that matters. The chain
  // icon from `url:` and the injected labelled link are the two ways in.
  // Written as paragraphs, which only render because of the scoped pre-wrap rule
  // above - a description flattened back to one line loses nothing but says less.
  h.check(name + ' writes its description in paragraphs',
    (declaredDescription(read(name, name + '.yml')) || '').indexOf('\\n\\n') !== -1,
    'no blank line in the description');
  // Every description lives twice - the plugin yml Stash reads, and the package
  // manifest an install-by-URL reads - and a hand edit to one has already left the
  // other behind.
  h.check(name + ' has the same description in its yml and its manifest',
    declaredDescription(read(name, name + '.yml')) ===
      declaredDescription(read(name, 'manifest')),
    'yml: ' + String(declaredDescription(read(name, name + '.yml'))).slice(0, 60) +
    ' / manifest: ' + String(declaredDescription(read(name, 'manifest'))).slice(0, 60));
  h.check(name + ' keeps the raw URL out of its description',
    !/https?:\/\//.test(declaredDescription(read(name, name + '.yml')) || ''),
    (declaredDescription(read(name, name + '.yml')) || '').slice(0, 120));

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
