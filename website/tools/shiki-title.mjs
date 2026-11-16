// Gives every fence the site's glass-bevel card, and turns a fence's
// `title="..."` meta into a filename tab inside it.
export default function shikiTitle() {
  return {
    name: 'ouijit-title',
    pre(node) {
      node.properties.class = `${node.properties.class ?? ''} glass-bevel`.trim();
      const match = /title="([^"]+)"/.exec(this.options.meta?.__raw ?? '');
      if (match) {
        node.children.unshift({
          type: 'element',
          tagName: 'span',
          properties: { class: 'writing-code-title' },
          children: [{ type: 'text', value: match[1] }],
        });
      }
    },
  };
}
