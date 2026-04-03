/**
 * Rule: valid-title-type
 * Validates Title component type prop values
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure Title type is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidType: 'Title type must be one of: h1, h2, h3, h4, h5, h6. Got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    const validTypes = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Title') {
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
