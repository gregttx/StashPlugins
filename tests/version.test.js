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
  'PropagateTagsAndPerformers', 'CustomFieldsBulkEditor', 'TagBundleClipboard',
  'SceneVariants', 'EntityNameMaintainer'];

// The script-side table each plugin's settings are read through. Every plugin has
// exactly one, and a key in the yml that is missing from it is a setting the plugin
// never reads - or one that
// silently never got a tooltip.
const SETTING_TABLE = {
  NormalizeParentTags: 'var DEFAULTS = {',
  MergePerformerTagsToScenes: 'var SETTING_MAP = {',
  PropagateTagsAndPerformers: 'var DEFAULTS = {',
  CustomFieldsBulkEditor: 'var DEFAULTS = {',
  TagBundleClipboard: 'var DEFAULTS = {',
  SceneVariants: 'var DEFAULTS = {',
  EntityNameMaintainer: 'var DEFAULTS = {',
};

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

// The `settings:` block of a plugin yml, as { key: { displayName, description, type } }.
// Hand-parsed rather than with a YAML dependency: the block is a fixed two-level shape
// this repo writes by hand, and the suite has no install step.
function settingsBlock(text) {
  const out = {};
  const lines = text.split('\n');
  let inBlock = false, key = null;
  lines.forEach((line) => {
    if (/^settings:\s*$/.test(line)) { inBlock = true; return; }
    if (!inBlock) return;
    if (/^\S/.test(line)) { inBlock = false; return; }
    const k = /^ {2}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (k) { key = k[1]; out[key] = {}; return; }
    const f = /^ {4}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (f && key) out[key][f[1]] = f[2];
  });
  return out;
}

const quoted = (v) => (/^"(.*)"$/.exec(String(v || '').trim()) || [])[1];

// A double-quoted YAML scalar ends at the first *unescaped* quote, and what Stash drops
// when its yml will not parse is the whole plugin. Remove each backslash escape, and
// any quote still standing is one that ends it.
const unescapedQuote = (s) => (String(s || '').replace(/\\./g, '')).indexOf('"') !== -1;

// One sentence, five copies. They drifted once, when a de-Unicode pass took the `'s`
// out of four of them and left the fifth reading differently in the same console.
const BANNER = "This is the running script's own version - the settings page reads the " +
  'manifest instead, which can be newer than the script your browser has cached.';

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
  // A double-quoted YAML scalar ends at the first *unescaped* quote, and what Stash
  // drops when its yml will not parse is the whole plugin, not the description. CFBE
  // 0.2.4 shipped with a bare pair around "is empty" and stopped loading; the greedy
  // capture above still matched both files identically, so every other check passed.
  // Remove each backslash escape, and any quote still standing is one that ends it.
  h.check(name + ' escapes every quote inside its description',
    !unescapedQuote(declaredDescription(read(name, name + '.yml'))) &&
      !unescapedQuote(declaredDescription(read(name, 'manifest'))),
    String(declaredDescription(read(name, name + '.yml'))).slice(0, 120));
  h.check(name + ' keeps the raw URL out of its description',
    !/https?:\/\//.test(declaredDescription(read(name, name + '.yml')) || ''),
    (declaredDescription(read(name, name + '.yml')) || '').slice(0, 120));

  // Per-*setting* descriptions, which nothing used to check - which is how
  // MergePerformerTagsToScenes' settings page went on describing its two buttons as
  // "Copy ..." for two releases after the captions became "Add ...". A setting
  // description is read while the user is looking at the thing it describes, so a
  // stale caption there is worse than a stale one in the README.
  const settings = settingsBlock(read(name, name + '.yml'));
  const settingKeys = Object.keys(settings);
  h.check(name + ' declares at least one setting', settingKeys.length > 0);

  // The yml and the script's own table are the same list, in both directions.
  const src = read(name, name + '.js');
  const tableAt = src.indexOf(SETTING_TABLE[name]);
  const tableEnd = tableAt === -1 ? -1 : src.indexOf('\n  };', tableAt);
  const table = tableAt === -1 || tableEnd === -1 ? '' : src.slice(tableAt, tableEnd);
  h.check(name + ' has a settings table in its script', !!table, SETTING_TABLE[name]);
  const tableKeys = (table.match(/^\s{4}([A-Za-z0-9_]+):/gm) || [])
    .map((m) => m.trim().replace(':', ''));
  settingKeys.forEach((k) => h.check(name + ' reads its yml setting ' + k,
    tableKeys.indexOf(k) !== -1, 'not in ' + SETTING_TABLE[name]));
  tableKeys.forEach((k) => h.check(name + ' declares its script setting ' + k + ' in the yml',
    settingKeys.indexOf(k) !== -1, 'not in ' + name + '.yml'));

  settingKeys.forEach((key) => {
    const set = settings[key];
    h.check(name + '.' + key + ' has a displayName, a description and a type',
      !!set.displayName && !!set.description && !!set.type,
      Object.keys(set).join(','));
    // A short one-line description is written as a bare YAML scalar; anything with a
    // paragraph break or a quoted caption in it has to be a quoted one.
    const desc = quoted(set.description) || String(set.description || '');
    h.check(name + '.' + key + ' escapes every quote inside its description',
      !unescapedQuote(desc), String(desc).slice(0, 120));
    h.check(name + '.' + key + ' keeps the raw URL out of its description',
      !/https?:\/\//.test(desc || ''), String(desc).slice(0, 120));
    // A description quoting a caption is quoting one the user is looking at, so the
    // string has to still be in the script. Multi-word only: a single quoted word is
    // as likely to be a value or a mode name as a button.
    const captions = (String(desc || '').match(/\\"[^"\\]{3,60}\\"/g) || [])
      .map((c) => c.slice(2, -2))
      .filter((c) => /^[A-Z]/.test(c) && /\s/.test(c));
    captions.forEach((c) => h.check(name + '.' + key + ' quotes a caption the script has: "' + c + '"',
      src.indexOf(c) !== -1));
  });

  // A README and a source file describe the plugin, not its history (root
  // `CLAUDE.md`), and the rule was lost twice by being scoped or triggered loosely.
  // The trigger for a release-note block was written as "a major version - a rename, a
  // settings reset", which is a fact about the *diff*, and the block that earned it
  // said in effect "everything about your settings changed, and you need do nothing
  // about it". It is now a fact about the *user* - a breaking change with no trivial
  // migration - and that is not something a test can read. The scope was written as
  // "the README and nothing else", so the sources collected several hundred version
  // references in comments unchecked.
  //
  // What a test can read is the residue every violation leaves behind: a version
  // number. So every `X.Y.Z` in a plugin's README or its source has to be one of the
  // shapes that are facts about today rather than about a release - a requirement
  // ("... or newer"), the plugin's own current version, or a quoted literal, which is
  // a value the code uses (`NPT_API_MIN`) or an example of one (`cmpVersion`'s own
  // comment). A release-note block fails here on its own heading.
  const strayVersions = (text) => {
    const out = [];
    text.replace(/\d+\.\d+\.\d+/g, (v, at) => {
      const before = text.slice(at - 1, at);
      const after = text.slice(at + v.length, at + v.length + 12);
      const quoted = /['"]/.test(before) && /^['"]/.test(after);
      if (quoted || /^\*{0,2}\s+or newer/.test(after) || v === manifest) return v;
      const line = text.slice(0, at).split('\n').length;
      out.push(line + ': ' + text.slice(Math.max(0, at - 30), at + 30).replace(/\n/g, ' '));
      return v;
    });
    return out;
  };

  [['README.md', 'README'], [name + '.js', 'source']].forEach((f) => {
    const stray = strayVersions(read(name, f[0]));
    h.check(name + ' keeps release history out of its ' + f[1], stray.length === 0,
      stray.join('  |  '));
  });
  const banner = load(name).filter((l) => l.indexOf(name + '.js') !== -1);
  h.check(name + ' announces itself at load', banner.length === 1, banner.join(' | '));

  const line = banner[0] || '';
  h.check(name + ' announces the version its manifest declares',
    line.indexOf(name + '.js ' + manifest + ' loaded') !== -1, line);
  // Without this the line is just one more version to disbelieve alongside the one
  // on the settings page - the value is in saying which of the two can be trusted.
  // Pinned as the whole sentence, not just /manifest/: the five copies drifted once,
  // when a de-Unicode pass took the `'s` out of four of them and left the fifth.
  h.check(name + " says the number is the script's own, not the manifest",
    line.indexOf(BANNER) !== -1, line);
});

h.finish();
