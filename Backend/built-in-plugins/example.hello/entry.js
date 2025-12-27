// Example OpenVCS plugin (runs in the UI as an ESM module).
window.OpenVCS?.registerPlugin({
  actions: {
    'example.hello:say': () => {
      window.OpenVCS?.notify('Hello from example.hello');
    },
  },
  menuItems: [{ label: 'Say Hello', action: 'example.hello:say' }],
  titlebarButtons: [{ label: 'Hello', action: 'example.hello:say', title: 'Run example.hello:say' }],
  hooks: {
    preCommit: (ctx) => {
      const summary = String(ctx?.data?.summary || '').trim();
      if (summary.toUpperCase().startsWith('WIP')) {
        ctx.cancel('Commit blocked by example.hello (summary starts with WIP)');
        return;
      }
      // Example mutation: prefix the summary.
      if (summary && !summary.startsWith('[Hello] ')) {
        ctx.data.summary = `[Hello] ${summary}`;
      }
    },
    prePush: (ctx) => {
      // Example: block pushes from detached HEAD / unknown branch.
      const branch = String(ctx?.data?.branch || '').trim();
      if (!branch || branch.startsWith('Detached')) {
        ctx.cancel('Push blocked by example.hello (no branch checked out)');
      }
    },
    postPush: () => {
      window.OpenVCS?.notify('example.hello saw a push complete');
    },
  },
});

