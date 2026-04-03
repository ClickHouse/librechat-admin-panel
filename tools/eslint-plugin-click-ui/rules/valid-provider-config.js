/**
 * Rule: valid-provider-config
 * Validates ClickUIProvider config prop structure
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure ClickUIProvider config prop has valid structure',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidConfig: 'ClickUIProvider config should be an object. Example: config={{tooltip: {delayDuration: 0}}}',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'ClickUIProvider') {
          const configAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'config'
          );

          if (configAttr && configAttr.value) {
            // Check if it's an expression container with an object
            if (configAttr.value.type === 'JSXExpressionContainer') {
              const expression = configAttr.value.expression;
              
              // If it's not an object expression, warn
              if (expression.type !== 'ObjectExpression') {
                context.report({
                  node: configAttr,
                  messageId: 'invalidConfig',
                });
              }
            }
          }
        }
      },
    };
  },
};
