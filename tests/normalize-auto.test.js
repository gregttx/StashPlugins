// Auto Prune / Auto Roll Up on entity updates: the reactive half of
// NormalizeParentTags. What matters here is mostly what it does *not* do - react to
// its own writes, react while another plugin holds a lease, or chase a mutation
// round in a circle with a plugin that disagrees with it.
'use strict';
const h = require('./npt-harness');

// Scene 10 carries Platinum (3) and both of its implied ancestors, so Prune has
// something to remove and Roll Up has nothing to add. Scene 20 carries only
// Platinum, so it is the other way round.
const SCENES = [
  { id: '10', title: 'Ten', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] },
  { id: '20', title: 'Twenty', organized: false, tags: [{ id: '3' }] },
];
const PERFORMERS = [
  { id: '77', name: 'Jane', tags: [{ id: '1' }, { id: '2' }] },
];

const LIB = {
  findScenes: { node: 'scenes', list: SCENES },
  findPerformers: { node: 'performers', list: PERFORMERS },
};

// `settings` is merged over the auto-prune-on-scenes baseline every case starts from.
function boot(settings, opts) {
  const o = Object.assign({
    quiet: true,
    respond: h.makeResponder(Object.assign({
      entities: LIB,
      settings: Object.assign({ a5EnableScenes: true, a8AutoPruneOnUpdate: true }, settings),
    }, opts || {})),
  }, {});
  const env = h.makeEnv(o);
  h.run(env.ctx);
  return env;
}

const tagQueries = (calls) => calls.filter((c) => /NPTTags/.test(c.query || ''));

Promise.resolve()

  // ── The basic reaction, both directions ───────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a scene save triggers one bulk write', bulks.length === 1,
          'got ' + bulks.length);
        h.check('it is a REMOVE delta on the saved scene',
          bulks[0].variables.input.tag_ids.mode === 'REMOVE' &&
          bulks[0].variables.input.ids.join() === '10');
        h.check('it removes both implied ancestors, not the leaf',
          bulks[0].variables.input.tag_ids.ids.slice().sort().join() === '1,2');
      });
  })

  .then(() => {
    const env = boot({ a8AutoPruneOnUpdate: false, a9AutoRollUpOnUpdate: true });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('auto roll up adds instead', bulks.length === 1 &&
          bulks[0].variables.input.tag_ids.mode === 'ADD');
        h.check('it adds every ancestor of Platinum',
          bulks[0].variables.input.tag_ids.ids.slice().sort().join() === '1,2,6');
      });
  })

  // A scene that is already normalized costs a read and no write.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush()).then(() => {
        h.check('nothing to prune writes nothing', h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The settings gates ────────────────────────────────────────────────────
  .then(() => {
    const env = boot({ a8AutoPruneOnUpdate: false });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('both modes off writes nothing', h.bulkCalls(env.calls).length === 0);
        h.check('and never loads the tag hierarchy', tagQueries(env.calls).length === 0);
      });
  })

  // Exact opposites: one adds what the other removes, so both on runs neither.
  .then(() => {
    const env = boot({ a9AutoRollUpOnUpdate: true });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('both modes on writes nothing', h.bulkCalls(env.calls).length === 0);
      });
  })

  // The a1-a7 toggles scope auto mode exactly as they scope the tasks.
  .then(() => {
    const env = boot({ a1EnablePerformers: false });
    return h.entityUpdate(env.ctx, 'performerUpdate', { id: '77' })
      .then(() => h.flush()).then(() => {
        h.check('a disabled entity type is not reacted to',
          h.bulkCalls(env.calls).length === 0);
      });
  })

  .then(() => {
    const env = boot({ a1EnablePerformers: true });
    return h.entityUpdate(env.ctx, 'performerUpdate', { id: '77' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('an enabled one is', bulks.length === 1 &&
          /bulkPerformerUpdate/.test(bulks[0].query));
      });
  })

  // ── Bulk mutations ────────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'bulkSceneUpdate', { ids: ['10', '20'] })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a bulk edit is reacted to as one write', bulks.length === 1);
        h.check('and covers only the entity that needed changing',
          bulks[0].variables.input.ids.join() === '10');
      });
  })

  // ── Not reacting to ourselves ─────────────────────────────────────────────
  //
  // Our own write is a bulkSceneUpdate, which is exactly what the wrapper watches
  // for. Two independent things stop it cascading, and on this path they overlap:
  // _writeDepth excludes the write outright, and the cooldown would drop it anyway
  // because a self-reaction always targets ids we marked a moment earlier. So this
  // asserts the outcome, not the mechanism - _writeDepth is isolated further down,
  // by the task-apply case, where nothing marks a cooldown.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush(120)).then(() => {
        h.check('an auto write does not cascade into another one',
          h.bulkCalls(env.calls).length === 1,
          'got ' + h.bulkCalls(env.calls).length);
      });
  })

  // The cooldown is the backstop for a plugin that does not honour the lease and
  // writes the tags straight back. One round, then we leave it alone.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' }))
      .then(() => h.flush()).then(() => {
        h.check('a second update to the same entity is inside the cooldown',
          h.bulkCalls(env.calls).length === 1,
          'got ' + h.bulkCalls(env.calls).length);
      });
  })

  // An entity we planned nothing for was never written, so it is not on cooldown:
  // a later edit that does make it redundant must still be caught.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' }))
      .then(() => h.flush()).then(() => {
        h.check('an entity we did not write to is not on cooldown',
          h.bulkCalls(env.calls).length === 1);
      });
  })

  // ── Standing down ─────────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    env.ctx.window.StashPluginCoop.leases.push({
      owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() + 60000,
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a live lease stands auto mode down', h.bulkCalls(env.calls).length === 0);
      });
  })

  .then(() => {
    const env = boot();
    env.ctx.window.StashPluginCoop.leases.push({
      owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() - 1,
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an expired lease does not', h.bulkCalls(env.calls).length === 1);
      });
  })

  .then(() => {
    const env = boot();
    h.check('the plugin registers as a lease respecter',
      env.ctx.window.StashPluginCoop.respecters.NormalizeParentTags === true);
    return null;
  })

  // A lease is taken while it writes, so a reactive sibling stands down for us.
  .then(() => {
    const env = boot();
    let heldDuringWrite = false;
    const spy = h.makeResponder({
      entities: LIB,
      settings: { a5EnableScenes: true, a8AutoPruneOnUpdate: true },
    });
    const env2 = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        if (/mutation NPT_bulk/.test(req.query || '')) {
          heldDuringWrite = env2.ctx.window.StashPluginCoop.leases.length > 0;
        }
        return spy(req, calls);
      },
    });
    h.run(env2.ctx);
    return h.entityUpdate(env2.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a lease is held while auto mode writes', heldDuringWrite);
        h.check('and released afterwards',
          env2.ctx.window.StashPluginCoop.leases.length === 0);
        return env;
      });
  })

  // ── A rejected save is not a save ─────────────────────────────────────────
  .then(() => {
    const env = h.makeEnv({
      quiet: true,
      respond: (req) => {
        // The user's own mutation comes back with GraphQL errors at HTTP 200 -
        // "the request came back" is not "the edit was saved".
        if (/mutation Stash_/.test(req.query || '')) return { errors: [{ message: 'nope' }] };
        return h.makeResponder({
          entities: LIB,
          settings: { a5EnableScenes: true, a8AutoPruneOnUpdate: true },
        })(req);
      },
    });
    h.run(env.ctx);
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a rejected save is not reacted to', h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The exclusion filters still apply ─────────────────────────────────────
  .then(() => {
    const env = boot({ c3ExcludeRemoveTagNameContains: 'Hair' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a protected tag is not removed by auto mode',
          bulks.length === 1 && bulks[0].variables.input.tag_ids.ids.join() === '2');
      });
  })

  .then(() => {
    const env = boot({ b2ExcludeOrganized: true }, {
      entities: {
        findScenes: {
          node: 'scenes',
          list: [{ id: '10', title: 'Ten', organized: true, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }],
        },
      },
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an organized entity is skipped', h.bulkCalls(env.calls).length === 0);
      });
  })

  // A configured exclusion tag that matches nothing stops auto mode rather than
  // letting it run unfiltered over the entities it was meant to protect.
  .then(() => {
    const env = boot({ b1ExcludeEntityWithTagName: 'No Such Tag' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an unresolvable exclusion tag stops auto mode',
          h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The task and auto mode in one tab ─────────────────────────────────────
  //
  // Phase 2 writes bulk*Update for every batch. With Auto Prune on, an unguarded
  // apply re-plans each batch it has just written.
  .then(() => {
    const env = boot();
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = h.dialog(env.body);
      d.button('Proceed').click();
      return h.flush(120).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('the task apply is not reacted to by auto mode', bulks.length === 1,
          'got ' + bulks.length);
      });
    });
  })

  // ── The tag graph cache ───────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '30' }))
      .then(() => h.flush()).then(() => {
        h.check('the tag hierarchy is fetched once and cached',
          tagQueries(env.calls).length === 1, 'got ' + tagQueries(env.calls).length);
      });
  })

  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'tagUpdate', { id: '1' }))
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '30' }))
      .then(() => h.flush()).then(() => {
        h.check('a tag mutation invalidates it',
          tagQueries(env.calls).length === 2, 'got ' + tagQueries(env.calls).length);
      });
  })

  // ── The both-modes-on notice on the settings page ─────────────────────────
  //
  // Both modes on runs neither, which is safe and invisible. The notice is the
  // only thing that makes it visible, and it must never do more than report.

  .then(() => {
    // A settings page with our own SettingGroup on it, plus another plugin's, so
    // the notice has to pick the right heading rather than the first one.
    function settingsPage(settings, path) {
      const env = boot(settings);
      env.ctx.location.pathname = path || '/settings';
      env.ctx.location.search = path ? '' : '?tab=plugins';
      const other = h.makeElement('div');
      const otherH = h.makeElement('h3');
      otherH.textContent = 'Some Other Plugin';
      other.appendChild(otherH);
      const group = h.makeElement('div');
      const heading = h.makeElement('h3');
      heading.textContent = 'Normalize Parent Tags';
      const firstSetting = h.makeElement('div');
      firstSetting.textContent = 'Include Performers';
      group.appendChild(heading);
      group.appendChild(firstSetting);
      env.ctx.document.body.appendChild(other);
      env.ctx.document.body.appendChild(group);
      return { env, group, other, heading, firstSetting };
    }
    const notice = (env) => env.ctx.document.getElementById('npt-conflict-notice');

    // Both on.
    const a = settingsPage({ a9AutoRollUpOnUpdate: true });
    a.env.tick();
    return h.flush().then(() => {
      const n = notice(a.env);
      h.check('both modes on shows a notice', !!n);
      h.check('it names both settings and says neither is running',
        !!n && n.textContent.indexOf('Auto Prune on Entity Updates') !== -1 &&
        n.textContent.indexOf('Auto Roll Up on Entity Updates') !== -1 &&
        n.textContent.indexOf('neither is running') !== -1, n && n.textContent);
      h.check('it lands inside our own group, under its heading',
        !!n && n.parentNode === a.group && a.group.childNodes.indexOf(n) === 1,
        n ? String(a.group.childNodes.indexOf(n)) : 'missing');
      h.check('and not in the other plugin group',
        a.other.descendants().indexOf(n) === -1);

      // Ticking again must not stack a second copy.
      a.env.tick();
      return h.flush().then(() => {
        const all = a.env.ctx.document.body.descendants()
          .filter((x) => x.id === 'npt-conflict-notice');
        h.check('repeated ticks do not duplicate it', all.length === 1, 'got ' + all.length);

        h.check('it writes nothing', h.bulkCalls(a.env.calls).length === 0 &&
          !a.env.calls.some((c) => /configurePlugin/.test(c.query || '')));
      });
    });
  })

  // Only one mode on: no notice.
  .then(() => {
    const env = boot();
    env.ctx.location.pathname = '/settings';
    env.ctx.location.search = '?tab=plugins';
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'Normalize Parent Tags';
    group.appendChild(heading);
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush().then(() => {
      h.check('one mode on shows no notice',
        !env.ctx.document.getElementById('npt-conflict-notice'));
    });
  })

  // Off a settings page it must neither render nor cost a settings query.
  .then(() => {
    const env = boot({ a9AutoRollUpOnUpdate: true });
    env.ctx.location.pathname = '/scenes';
    env.ctx.location.search = '';
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'Normalize Parent Tags';
    group.appendChild(heading);
    env.ctx.document.body.appendChild(group);
    const before = env.calls.length;
    env.tick();
    return h.flush().then(() => {
      h.check('no notice away from the settings page',
        !env.ctx.document.getElementById('npt-conflict-notice'));
      h.check('and no settings query is issued there',
        env.calls.length === before, 'issued ' + (env.calls.length - before));
    });
  })

  // Turning one off while the page is open takes the notice away again.
  .then(() => {
    let both = true;
    const env = h.makeEnv({
      quiet: true,
      respond: (req) => {
        if ((req.query || '').indexOf('configuration') !== -1) {
          return { data: { configuration: { plugins: { NormalizeParentTags: {
            a5EnableScenes: true, a8AutoPruneOnUpdate: true, a9AutoRollUpOnUpdate: both,
          } } } } };
        }
        return { data: {} };
      },
    });
    h.run(env.ctx);
    env.ctx.location.pathname = '/settings';
    env.ctx.location.search = '?tab=plugins';
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'Normalize Parent Tags';
    group.appendChild(heading);
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush().then(() => {
      h.check('notice is up while both are on',
        !!env.ctx.document.getElementById('npt-conflict-notice'));
      both = false;
      // The settings cache is what the notice reads, so let its TTL lapse the way
      // a real page would before ticking again.
      env.ctx.Date = { now: () => Date.now() + 60000 };
      env.tick();
      return h.flush().then(() => {
        h.check('and comes down once one is turned off',
          !env.ctx.document.getElementById('npt-conflict-notice'));
      });
    });
  })

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
