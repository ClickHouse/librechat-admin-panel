/**
 * Rule: valid-spacing-token
 * Validates spacing token values (gap, padding, etc.)
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure spacing tokens are valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidSpacing: 'Spacing token must be one of: none, xxs, xs, sm, md, lg, xl, xxl. Got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    const validSpacings = ['none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
    const spacingProps = ['gap', 'padding', 'margin'];

    return {
      JSXAttribute(node) {
        if (spacingProps.includes(node.name.name) && node.value) {
          let spacingValue = '';
          
          if (node.value.type === 'Literal') {
            spacingValue = node.value.value;
          } else if (node.value.type === 'JSXExpressionContainer' && 
                     node.value.expression.type === 'Literal') {
            spacingValue = node.value.expression.value;
          }

          if (spacingValue && !validSpacings.includes(spacingValue)) {
            context.report({
              node,
              messageId: 'invalidSpacing',
              data: { value: spacingValue },
            });
          }
        }
      },
    };
  },
};
