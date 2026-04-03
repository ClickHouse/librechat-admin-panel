/**
 * Rule: table-structure
 * Ensures Table component uses correct props (headers/rows, not data/columns)
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Table component requires headers and rows props, not data or columns',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingHeaders: 'Table component requires "headers" prop with array of {label, isSortable?}.',
      missingRows: 'Table component requires "rows" prop with array of {id, items: [{label}]}.',
      wrongPropData: 'Table component does not accept "data" prop. Use "rows" instead.',
      wrongPropColumns: 'Table component does not accept "columns" prop. Use "headers" instead.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Table') {
          const hasHeaders = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'headers'
          );
          const hasRows = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'rows'
          );
          const hasData = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'data'
          );
          const hasColumns = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'columns'
          );

          if (!hasHeaders) {
            context.report({
              node: openingElement,
              messageId: 'missingHeaders',
            });
          }

          if (!hasRows) {
            context.report({
              node: openingElement,
              messageId: 'missingRows',
            });
          }

          if (hasData) {
            const dataProp = openingElement.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'data'
            );
            context.report({
              node: dataProp,
              messageId: 'wrongPropData',
            });
          }

          if (hasColumns) {
            const columnsProp = openingElement.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'columns'
            );
            context.report({
              node: columnsProp,
              messageId: 'wrongPropColumns',
            });
          }
        }
      },
    };
  },
};
