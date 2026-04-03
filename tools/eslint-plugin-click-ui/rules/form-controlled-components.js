/**
 * Rule: form-controlled-components
 * Ensures form components use controlled state (value + onChange)
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Form components must be controlled with value and onChange props',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingValue: '{{component}} requires "value" prop for controlled state.',
      missingOnChange: '{{component}} requires "onChange" prop for controlled state.',
    },
    schema: [],
  },

  create(context) {
    const formComponents = [
      'TextField',
      'TextArea',
      'NumberField',
      'PasswordField',
      'SearchField',
    ];

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (formComponents.includes(elementName)) {
          const hasValue = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'value'
          );
          const hasOnChange = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onChange'
          );

          if (!hasValue) {
            context.report({
              node: openingElement,
              messageId: 'missingValue',
              data: { component: elementName },
            });
          }

          if (!hasOnChange) {
            context.report({
              node: openingElement,
              messageId: 'missingOnChange',
              data: { component: elementName },
            });
          }
        }
      },
    };
  },
};
