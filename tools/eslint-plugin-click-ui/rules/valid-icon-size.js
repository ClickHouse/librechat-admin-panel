/**
 * Rule: valid-icon-size
 * Validates Icon size prop values
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure Icon size is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidSize: 'Icon size must be one of: xs, sm, md, lg, xl, xxl. Got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    const validSizes = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Icon') {
          const sizeAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'size'
          );

          if (sizeAttr && sizeAttr.value) {
            let sizeValue = '';
            
            if (sizeAttr.value.type === 'Literal') {
              sizeValue = sizeAttr.value.value;
            } else if (sizeAttr.value.type === 'JSXExpressionContainer' && 
                       sizeAttr.value.expression.type === 'Literal') {
              sizeValue = sizeAttr.value.expression.value;
            }

            if (sizeValue && !validSizes.includes(sizeValue)) {
              context.report({
                node: sizeAttr,
                messageId: 'invalidSize',
                data: { value: sizeValue },
              });
            }
          }
        }
      },
    };
  },
};
