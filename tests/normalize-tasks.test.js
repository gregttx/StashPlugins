// Task interception. The plugin declares its tasks in the manifest so Stash lists
// them natively, but it has no exec - so a click that reaches the server can only
// queue a job that fails. Both layers that stop that are checked here.
'use strict';
const h = require('./npt-harness');

function makeEnv() {
  const env = h.makeEnv({ quiet: true, respond: h.makeResponder({ settings: { a5EnableScenes: false } }) });
  h.run(env.ctx);
  return env;
}

// Builds the markup PluginTasks renders: a SettingGroup headed with the plugin
// name, containing one Setting per task with a button carrying the task name.
function taskButton(env, heading, label) {
  const doc = env.ctx.document;
  const group = doc.createElement('div');
  const h3 = doc.createElement('h3');
  h3.textContent = heading;
  group.appendChild(h3);
  const setting = doc.createElement('div');
  const btn = doc.createElement('button');
  btn.textContent = label;
  setting.appendChild(btn);
  group.appendChild(setting);
  env.body.appendChild(group);
  return btn;
}

function clickCapture(env, target) {
  let defaultPrevented = false, propagationStopped = false;
  (env.ctx.document.handlers.click || []).forEach((fn) => fn({
    target: target,
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  }));
  return { defaultPrevented, propagationStopped };
}

function runPluginTask(env, pluginId, taskName) {
  const before = env.calls.length;
  const p = env.ctx.window.fetch('/graphql', {
    body: JSON.stringify({
      query: 'mutation RunPluginTask($plugin_id: ID!, $task_name: String) { runPluginTask(plugin_id: $plugin_id, task_name: $task_name) }',
      variables: { plugin_id: pluginId, task_name: taskName },
    }),
  });
  // "Forwarded" means the mutation itself reached the server - not that the plugin
  // made any request, since opening the dialog immediately queries settings.
  return p.then((resp) => resp.json().then((json) => ({
    json,
    forwarded: env.calls.slice(before).some((c) => /runPluginTask/.test(c.query || '')),
  })));
}

Promise.resolve()

  // ── Layer 1: the click ───────────────────────────────────────────────────
  .then(() => {
    const env = makeEnv();
    const btn = taskButton(env, 'GTTx Normalize Parent Tags', h.TASK_PRUNE);
    const ev = clickCapture(env, btn);
    return h.flush().then(() => {
      h.check('a task click is stopped before React sees it',
        ev.defaultPrevented && ev.propagationStopped);
      h.check('a task click opens the dialog instead of queueing a job',
        h.dialog(env.body).open);
      h.check('a task click issues no runPluginTask',
        !env.calls.some((c) => /runPluginTask/.test(c.query || '')));
    });
  })

  .then(() => {
    // Another plugin is free to declare a task with the same name; only the group
    // heading distinguishes them.
    const env = makeEnv();
    const btn = taskButton(env, 'Some Other Plugin', h.TASK_PRUNE);
    const ev = clickCapture(env, btn);
    return h.flush().then(() => {
      h.check('another plugin task with the same name is left alone',
        !ev.defaultPrevented && !ev.propagationStopped && !h.dialog(env.body).open);
    });
  })

  .then(() => {
    const env = makeEnv();
    const btn = taskButton(env, 'GTTx Normalize Parent Tags', 'Scan');
    const ev = clickCapture(env, btn);
    return h.flush().then(() => {
      h.check('an unrelated button in our own group is left alone',
        !ev.defaultPrevented && !h.dialog(env.body).open);
    });
  })

  .then(() => {
    const env = makeEnv();
    const btn = taskButton(env, 'GTTx Normalize Parent Tags', h.TASK_ROLLUP);
    clickCapture(env, btn);
    return h.flush().then(() => {
      const d = h.dialog(env.body);
      h.check('the clicked task decides which run starts',
        d.lines.some((l) => l.indexOf(h.TASK_ROLLUP) !== -1), d.lines.join(' | '));
    });
  })

  // ── Layer 2: the mutation ────────────────────────────────────────────────
  .then(() => {
    const env = makeEnv();
    return runPluginTask(env, 'NormalizeParentTags', h.TASK_PRUNE).then(({ json, forwarded }) => {
      h.check('runPluginTask for this plugin never reaches the server', !forwarded);
      h.check('the mutation is answered with a success rather than an error',
        !json.errors && !!json.data.runPluginTask, JSON.stringify(json));
      return h.flush().then(() => {
        h.check('the backstop opens the dialog too', h.dialog(env.body).open);
      });
    });
  })

  .then(() => {
    const env = makeEnv();
    return runPluginTask(env, 'SomeOtherPlugin', 'Do A Thing').then(({ forwarded }) => {
      h.check('another plugin runPluginTask is forwarded untouched', forwarded);
      return h.flush().then(() => {
        h.check('another plugin runPluginTask opens no dialog', !h.dialog(env.body).open);
      });
    });
  })

  .then(() => {
    const env = makeEnv();
    return runPluginTask(env, 'NormalizeParentTags', h.TASK_PRUNE)
      .then(() => h.flush())
      .then(() => runPluginTask(env, 'NormalizeParentTags', h.TASK_PRUNE))
      .then(() => h.flush())
      .then(() => {
        const modals = env.body.descendants().filter((n) => h.hasClass(n, 'npt-modal'));
        h.check('a second run while one is open does not stack dialogs', modals.length === 1,
          'got ' + modals.length);
      });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
