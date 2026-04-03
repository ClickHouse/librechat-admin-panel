/**
 * Rule: valid-button-type
 * Validates Button type prop values
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure Button type is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidType: 'Button type must be one of: primary, secondary, empty, danger, ghost. Got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    const validTypes = ['primary', 'secondary', 'empty', 'danger', 'ghost'];

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Button') {
          const typeAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'type'
          );

          if (typeAttr && typeAttr.value) {
            let typeValue = '';
            
            if (typeAttr.value.type === 'Literal') {
              typeValue = typeAttr.value.value;
            } else if (typeAttr.value.type === 'JSXExpressionContainer' && 
                       typeAttr.value.expression.type === 'Literal') {
              typeValue = typeAttr.value.expression.value;
            }

            if (typeValue && !validTypes.includes(typeValue)) {
              context.report({
                node: typeAttr,
                messageId: 'invalidType',
                data: { value: typeValue },
              });
            }
          }
        }
      },
    };
  },
};
