// The dialogs are one design in three files. No plugin can import another's
// stylesheet - a plugin folder is copied as-is, with no build step and no shared
// module - so each carries its own CSS string, and nothing but this suite stops them
// drifting. Two of them did drift: the modal was #202b33 in one and #30404d in the
// other for four months, because the second was written a day after the first and
// never compared with it.
//
// Only the overlap is pinned. Each dialog has rules the others have no use for (the
// hierarchy viewer's tree and inspector, each plugin's own log-line kinds), and
// those are free to differ - a selector only one plugin defines is ignored.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const PLUGINS = [
  { name: 'NormalizeParentTags', prefix: 'npt', decl: 'var CSS =' },
  { name: 'MergePerformerTagsToScenes', prefix: 'cpt2s', decl: 'var TASK_CSS =' },
  { name: 'PropagateTagsAndPerformers', prefix: 'ptp2re', decl: 'var CSS =' },
];

// The CSS is a run of single-quoted fragments joined with +. Pull the block out,
// drop the comment lines and the JS quoting, and what is left is the stylesheet.
function readCss(plugin) {
  const file = path.join(__dirname, '..', plugin.name, plugin.name + '.js');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(plugin.decl);
  if (start === -1) throw new Error('no ' + plugin.decl + ' in ' + plugin.name);
  const end = src.indexOf("';", start);
  if (end === -1) throw new Error('unterminated ' + plugin.decl + ' in ' + plugin.name);
  return src.slice(start + plugin.decl.length, end + 1)
    .split('\n')
    .filter((l) => l.trim().indexOf('//') !== 0)
    .join('')
    .replace(/'\s*\+\s*'/g, '')
    .replace(/'/g, '')
    .trim();
}

// selector -> declarations, with the plugin's own prefix stripped so they are
// comparable: `.npt-modal`, `.cpt2s-modal` and `.ptp2re-modal` are all `.modal`.
function rules(css, prefix) {
  const out = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim().split('.' + prefix + '-').join('.');
    out[selector] = m[2].trim();
  }
  return out;
}

const parsed = PLUGINS.map((p) => ({ plugin: p, rules: rules(readCss(p), p.prefix) }));

parsed.forEach((p) => {
  h.check(p.plugin.name + ' declares a stylesheet', Object.keys(p.rules).length > 5,
    String(Object.keys(p.rules).length) + ' rules');
});

// The chrome every dialog is built from. Named rather than merely compared, so a
// plugin that quietly stopped defining one of them fails here instead of passing by
// having nothing to disagree about.
const CHROME = ['.backdrop', '.modal', '.head', '.title', '.warn', '.note', '.legend',
  '.progress', '.log', '.line', '.foot', '.hidden'];

// The settings-page rules, shared since NormalizeParentTags 1.7.5 and
// MergePerformerTagsToScenes 1.11.0. Same rule as the chrome: one design, one
// stylesheet, three copies of it.
const SETTINGS = ['.own-group .sub-heading', '.tipped', '.tip', '.tipbox',
  '.tipped.tip-open .tipbox', '.desc-collapsed .p:not(:first-child)', '.desc-toggle'];

parsed.forEach((p) => {
  h.check(p.plugin.name + ' defines the shared dialog chrome',
    CHROME.every((s) => Object.prototype.hasOwnProperty.call(p.rules, s)),
    CHROME.filter((s) => !Object.prototype.hasOwnProperty.call(p.rules, s)).join(' ') || 'all present');
  h.check(p.plugin.name + ' defines the shared settings-page rules',
    SETTINGS.every((s) => Object.prototype.hasOwnProperty.call(p.rules, s)),
    SETTINGS.filter((s) => !Object.prototype.hasOwnProperty.call(p.rules, s)).join(' ') || 'all present');
});

// Any selector two or more of them define is shared by construction, and every one
// has to agree - a difference here is two plugins disagreeing about what one dialog
// looks like. A selector only one defines is that plugin's own and is skipped.
const seen = {};
parsed.forEach((p) => {
  Object.keys(p.rules).forEach((s) => {
    if (!seen[s]) seen[s] = [];
    seen[s].push(p);
  });
});

Object.keys(seen).sort().forEach((selector) => {
  const owners = seen[selector];
  if (owners.length < 2) return;
  const first = owners[0];
  const same = owners.every((p) => p.rules[selector] === first.rules[selector]);
  h.check(selector + ' matches across ' + owners.length + ' plugins', same,
    owners.map((p) => p.plugin.prefix + ': ' + p.rules[selector]).join('\n        '));
});

// The modal is the one people see first, and the two values it drifted between are
// both plausible Stash greys - so name the one that is right rather than leaving the
// check to say only that they agree. #202b33 is what the dim greys in the log and
// the tree were chosen against, and it is what all three dialogs settled on.
parsed.forEach((p) => {
  h.check(p.plugin.name + ' uses the grey the rest of the palette was picked against',
    /background:#202b33/.test(p.rules['.modal'] || '') && !/#30404d/.test(p.rules['.modal'] || ''),
    p.rules['.modal']);
});

// The colour-coded toggles (NormalizeParentTags 1.8.0, MergePerformerTagsToScenes
// 1.17.0, PropagateTagsAndPerformers 0.17.0) are the one place a stylesheet names a
// *setting*. `#plugin-<id>-<key>` is Stash's own id and the key half is the storage
// key, so renaming a setting - which §6 of NormalizeParentTags' CLAUDE.md already
// warns resets it for every install - would also drop its colour, silently and with
// nothing else to notice it. The plugin id half is checked too: it is hardcoded in
// the string rather than built from PLUGIN_ID, so that the CSS parser above sees a
// plain literal.
//
// Not a check that any particular setting *is* coloured. Which ones are is a
// judgement (the ones that write on their own, plus the console one), and pinning the
// list here would make every future setting an edit in two files for no gain.
const SETTING_ID = /#plugin-([A-Za-z]+)-([A-Za-z0-9]+)/g;

parsed.forEach((p) => {
  const yml = fs.readFileSync(
    path.join(__dirname, '..', p.plugin.name, p.plugin.name + '.yml'), 'utf8');
  // The `settings:` block, as `key:` at one indent level under it.
  const block = yml.slice(yml.indexOf('\nsettings:'));
  const keys = (block.match(/^ {2}([A-Za-z0-9]+):$/gm) || [])
    .map((l) => l.trim().slice(0, -1));
  const named = [];
  let m;
  SETTING_ID.lastIndex = 0;
  while ((m = SETTING_ID.exec(Object.keys(p.rules).join(' '))) !== null) named.push(m);

  h.check(p.plugin.name + ' colours at least one setting toggle', named.length > 0,
    String(named.length) + ' selector(s)');
  h.check(p.plugin.name + ' names itself in every toggle selector',
    named.every((x) => x[1] === p.plugin.name),
    named.filter((x) => x[1] !== p.plugin.name).map((x) => x[0]).join(' ') || 'all match');
  h.check(p.plugin.name + ' colours only settings its yml declares',
    named.every((x) => keys.indexOf(x[2]) !== -1),
    named.filter((x) => keys.indexOf(x[2]) === -1).map((x) => x[2]).join(' ') ||
      'all ' + keys.length + ' key(s) known');
});

h.finish();
