/**
 * Rule: datepicker-controlled
 * Ensures DatePicker uses controlled state
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'DatePicker must use controlled state with date and onSelectDate props',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingDate: 'DatePicker requires "date" prop.',
      missingOnSelectDate: 'DatePicker requires "onSelectDate" prop.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'DatePicker') {
          const hasDate = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'date'
          );
          const hasOnSelectDate = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onSelectDate'
          );

          if (!hasDate) {
            context.report({
              node: openingElement,
              messageId: 'missingDate',
            });
          }

          if (!hasOnSelectDate) {
            context.report({
              node: openingElement,
              messageId: 'missingOnSelectDate',
            });
          }
        }
      },
    };
  },
};
