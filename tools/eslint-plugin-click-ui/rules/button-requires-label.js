/**
 * Rule: button-requires-label
 * Ensures Button component uses label prop instead of children
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Button component requires label prop, not children',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingLabel: 'Button component requires a "label" prop. Remove children and use label="{{text}}" instead.',
      hasChildren: 'Button component should not have children. Use the "label" prop instead.',
    },
    fixable: 'code',
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Button') {
          const hasLabelProp = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'label'
          );

          const hasChildren = node.children.length > 0;

          // Check if children contain actual text/content
          const hasContentChildren = node.children.some(child => {
            return (
              child.type === 'JSXText' && child.value.trim() !== '' ||
              child.type === 'JSXExpressionContainer' ||
              child.type === 'JSXElement'
            );
          });

          if (!hasLabelProp && hasContentChildren) {
            // Try to extract text for helpful error message
            let childText = '';
            const textChild = node.children.find(child => 
              child.type === 'JSXText' && child.value.trim() !== ''
            );
            if (textChild) {
              childText = textChild.value.trim();
            }

            context.report({
              node: openingElement,
              messageId: 'missingLabel',
              data: { text: childText || 'your text' },
              fix(fixer) {
                if (textChild) {
                  const sourceCode = context.sourceCode ?? context.getSourceCode();
                  
                  // Build the new opening tag with label prop
                  const existingAttrs = openingElement.attributes
                    .map(attr => sourceCode.getText(attr))
                    .join(' ');
                  
                  const labelProp = `label="${childText}"`;
                  const newAttrs = existingAttrs 
                    ? `${existingAttrs} ${labelProp}`
                    : labelProp;
                  
                  // Construct the new self-closing tag
                  const newTag = `<Button ${newAttrs} />`;
                  
                  // Replace the entire node with the new self-closing tag
                  return fixer.replaceText(node, newTag);
                }
                return null;
              },
            });
          } else if (hasLabelProp && hasContentChildren) {
            context.report({
              node,
              messageId: 'hasChildren',
            });
          }
        }
      },
    };
  },
};
