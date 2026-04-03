/**
 * Rule: avoid-generic-label
 * Warns against using GenericLabel when Label might be more appropriate
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Consider using Label instead of GenericLabel for form controls',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      considerLabel: 'Consider using <Label> instead of <GenericLabel> if this is for a form control.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'GenericLabel') {
          context.report({
            node: openingElement,
            messageId: 'considerLabel',
          });
        }
      },
    };
  },
};
