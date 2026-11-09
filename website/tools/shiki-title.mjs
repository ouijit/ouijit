// Carries a fence's `title="..."` meta onto the <pre>, where the page renders
// it as a filename tab.
export default function shikiTitle() {
  return {
    name: 'ouijit-title',
    pre(node) {
      const match = /title="([^"]+)"/.exec(this.options.meta?.__raw ?? '');
      if (match) node.properties['data-title'] = match[1];
    },
  };
}
