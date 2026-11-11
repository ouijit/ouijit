import { visit } from 'unist-util-visit';

// A paragraph holding only an image becomes a figure, with the image's title
// as its caption, so a post's Markdown stays plain `![alt](src "caption")`.
export default function remarkFigures() {
  return (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || node.children.length !== 1 || node.children[0].type !== 'image') return;
      const image = node.children[0];
      const caption = image.title ? `<figcaption>${image.title}</figcaption>` : '';
      parent.children[index] = {
        type: 'html',
        value: `<figure><img src="${image.url}" alt="${image.alt ?? ''}" loading="lazy" />${caption}</figure>`,
      };
    });
  };
}
