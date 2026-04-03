/**
 * Rule: select-requires-options
 * Ensures Select component has required props
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Select component requires value, onSelect, and options props',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingValue: 'Select requires "value" prop.',
      missingOnSelect: 'Select requires "onSelect" prop.',
      missingOptions: 'Select requires "options" prop with array of {label, value}.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Select') {
          const hasValue = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'value'
          );
          const hasOnSelect = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onSelect'
          );
          const hasOptions = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'options'
          );

          if (!hasValue) {
            context.report({
              node: openingElement,
              messageId: 'missingValue',
            });
          }

          if (!hasOnSelect) {
            context.report({
              node: openingElement,
              messageId: 'missingOnSelect',
            });
          }

          if (!hasOptions) {
            context.report({
              node: openingElement,
              messageId: 'missingOptions',
            });
          }
        }
      },
    };
  },
};
