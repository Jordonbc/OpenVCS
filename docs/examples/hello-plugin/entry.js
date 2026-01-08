window.OpenVCS?.registerPlugin({
  actions: {
    'example.hello:say': () => {
      window.OpenVCS?.notify('Hello from example.hello');
    },
  },
  menuItems: [
    { label: 'Say Hello', action: 'example.hello:say' },
  ],
  titlebarButtons: [
    { label: 'Hello', action: 'example.hello:say', title: 'Run example.hello:say' },
  ],
  hooks: {
    preCommit: (ctx) => {
      const summary = String(ctx?.data?.summary || '').trim();
      if (summary.toUpperCase().startsWith('WIP')) {
        ctx.cancel('Commit blocked by example.hello: summary starts with WIP');
      }
    },
    postPush: () => {
      window.OpenVCS?.notify('example.hello saw a push complete');
    },
  },
});

