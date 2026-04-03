/**
 * Rule: switch-controlled-state
 * Ensures Switch component uses controlled state with checked and onCheckedChange
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Switch must use controlled state with checked and onCheckedChange props',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingChecked: 'Switch requires "checked" prop for controlled state.',
      missingOnCheckedChange: 'Switch requires "onCheckedChange" prop for controlled state.',
      avoidOnClick: 'Switch should use "onCheckedChange" instead of "onClick".',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Switch') {
          const hasChecked = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'checked'
          );
          const hasOnCheckedChange = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onCheckedChange'
          );
          const hasOnClick = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onClick'
          );

          if (!hasChecked) {
            context.report({
              node: openingElement,
              messageId: 'missingChecked',
            });
          }

          if (!hasOnCheckedChange) {
            context.report({
              node: openingElement,
              messageId: 'missingOnCheckedChange',
            });
          }

          if (hasOnClick) {
            const onClickProp = openingElement.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'onClick'
            );
            context.report({
              node: onClickProp,
              messageId: 'avoidOnClick',
            });
          }
        }
      },
    };
  },
};
