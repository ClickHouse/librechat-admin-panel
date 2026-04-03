/**
 * Rule: checkbox-radiogroup-controlled
 * Ensures Checkbox and RadioGroup use controlled state
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Checkbox and RadioGroup must use controlled state',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingChecked: '{{component}} requires "checked" prop for controlled state.',
      missingOnCheckedChange: '{{component}} requires "onCheckedChange" prop for controlled state.',
      missingValue: 'RadioGroup requires "value" prop for controlled state.',
      missingOnValueChange: 'RadioGroup requires "onValueChange" prop for controlled state.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Checkbox') {
          const hasChecked = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'checked'
          );
          const hasOnCheckedChange = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onCheckedChange'
          );

          if (!hasChecked) {
            context.report({
              node: openingElement,
              messageId: 'missingChecked',
              data: { component: 'Checkbox' },
            });
          }

          if (!hasOnCheckedChange) {
            context.report({
              node: openingElement,
              messageId: 'missingOnCheckedChange',
              data: { component: 'Checkbox' },
            });
          }
        }

        if (elementName === 'RadioGroup') {
          const hasValue = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'value'
          );
          const hasOnValueChange = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onValueChange'
          );

          if (!hasValue) {
            context.report({
              node: openingElement,
              messageId: 'missingValue',
            });
          }

          if (!hasOnValueChange) {
            context.report({
              node: openingElement,
              messageId: 'missingOnValueChange',
            });
          }
        }
      },
    };
  },
};
