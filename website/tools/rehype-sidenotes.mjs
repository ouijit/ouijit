// Copies each footnote into a sidenote next to its reference. The footnotes
// list stays at the end of the post: CSS shows the sidenotes in the margin
// where there is room for them, and the list everywhere else.

function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
}

function isElement(node, tagName) {
  return node?.type === 'element' && node.tagName === tagName;
}

export default function rehypeSidenotes() {
  return (tree) => {
    const notes = new Map();
    walk(tree, (node) => {
      if (!isElement(node, 'li') || !String(node.properties?.id ?? '').startsWith('user-content-fn-')) return;
      const inline = node.children
        .filter((child) => isElement(child, 'p'))
        .flatMap((p) => p.children.filter((c) => !(isElement(c, 'a') && c.properties?.dataFootnoteBackref !== undefined)));
      notes.set(`#${node.properties.id}`, inline);
    });
    if (notes.size === 0) return;

    walk(tree, (node, parent) => {
      if (!isElement(node, 'sup') || !parent) return;
      const ref = node.children.find((c) => isElement(c, 'a') && c.properties?.dataFootnoteRef !== undefined);
      const content = ref && notes.get(ref.properties.href);
      if (!content) return;
      const number = ref.children.map((c) => c.value ?? '').join('');
      const sidenote = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['sidenote'], ariaHidden: 'true' },
        children: [
          { type: 'element', tagName: 'span', properties: { className: ['sidenote-number'] }, children: [{ type: 'text', value: number }] },
          ...structuredClone(content),
        ],
      };
      parent.children.splice(parent.children.indexOf(node) + 1, 0, sidenote);
    });
  };
}
