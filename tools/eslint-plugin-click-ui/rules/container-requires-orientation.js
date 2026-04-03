/**
 * Rule: container-requires-orientation
 * Ensures Container component has required orientation prop
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Container component requires orientation prop',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingOrientation: 'Container component requires "orientation" prop. Add orientation="horizontal" or orientation="vertical".',
      invalidOrientation: 'Container orientation must be "horizontal" or "vertical", got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Container') {
          const orientationAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'orientation'
          );

          if (!orientationAttr) {
            context.report({
              node: openingElement,
              messageId: 'missingOrientation',
            });
          } else if (orientationAttr.value) {
            let orientationValue = '';
            
            if (orientationAttr.value.type === 'Literal') {
              orientationValue = orientationAttr.value.value;
            } else if (orientationAttr.value.type === 'JSXExpressionContainer' && 
                       orientationAttr.value.expression.type === 'Literal') {
              orientationValue = orientationAttr.value.expression.value;
            }

            if (orientationValue && !['horizontal', 'vertical'].includes(orientationValue)) {
              context.report({
                node: orientationAttr,
                messageId: 'invalidOrientation',
                data: { value: orientationValue },
              });
            }
          }
        }
      },
    };
  },
};
